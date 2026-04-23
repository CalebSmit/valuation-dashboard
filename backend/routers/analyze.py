"""AI research agent endpoint — calls Claude API to generate valuation assumptions.

Uses a thread-safe queue to bridge synchronous provider on_step callbacks
into the async SSE event stream, with keepalive comments to prevent
browser/proxy timeouts during long API calls.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import queue as thread_queue
from datetime import date
from copy import deepcopy

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from config import PROVIDER_API_KEYS, RAW_DATA_PATH
from config import CACHE_DIR
from models.responses import AnalyzeRequest
from services.excel_reader import reader
from services.financial_summarizer import extract_financial_summary
from services.agent import run_valuation_agent
from services.pipeline_runner import is_pipeline_running
from services.ticker_validation import is_valid_ticker, normalize_ticker

router = APIRouter(tags=["analyze"])

_DEFAULT_FORECAST = {
    "revenue_forecasts": [],
    "ebit_margins": [],
    "ebitda_margins": [],
    "effective_tax_rate": 0.21,
    "account_overrides": [],
    "revenue_thesis": "",
    "margin_thesis": "",
    "key_assumptions": [],
}


def _sse(event_type: str, data: object) -> str:
    """Format a Server-Sent Event line."""
    if event_type == "result":
        return f"data: {json.dumps({'type': 'result', 'data': data})}\n\n"
    if event_type == "error":
        return f"data: {json.dumps({'type': 'error', 'message': data})}\n\n"
    return f"data: {json.dumps({'type': 'step', 'message': data})}\n\n"


def _get_cache_path(ticker: str, provider: str = "anthropic", deep: bool = False) -> str:
    mode = "deep" if deep else "std"
    return str(CACHE_DIR / f"{ticker}_{date.today().isoformat()}_{provider}_{mode}.json")


def _load_cached(ticker: str, provider: str = "anthropic", deep: bool = False) -> dict | None:
    cache_path = _get_cache_path(ticker, provider, deep)
    try:
        with open(cache_path, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

    # Fix 9: Invalidate if raw_data.xlsx was modified after cache was created
    if RAW_DATA_PATH.exists():
        try:
            raw_mtime = os.path.getmtime(RAW_DATA_PATH)
            cache_mtime = os.path.getmtime(cache_path)
            if raw_mtime > cache_mtime:
                return None
        except OSError:
            return None

    return data


def _save_cache(ticker: str, assumptions: dict, provider: str = "anthropic", deep: bool = False) -> None:
    cache_path = _get_cache_path(ticker, provider, deep)
    with open(cache_path, "w") as f:
        json.dump(assumptions, f, indent=2)


def _patch_forecast(cached: dict) -> dict:
    """Backward compatibility for cached results missing forecast fields."""
    cached_forecast = cached.get("forecast")
    if isinstance(cached_forecast, dict):
        merged_forecast = dict(_DEFAULT_FORECAST)
        merged_forecast.update(cached_forecast)
        for key in ("revenue_forecasts", "ebit_margins", "ebitda_margins", "account_overrides", "key_assumptions"):
            if not isinstance(merged_forecast.get(key), list):
                merged_forecast[key] = []
        for key in ("revenue_thesis", "margin_thesis"):
            if not isinstance(merged_forecast.get(key), str):
                merged_forecast[key] = ""
        if not isinstance(merged_forecast.get("effective_tax_rate"), (int, float)):
            merged_forecast["effective_tax_rate"] = _DEFAULT_FORECAST["effective_tax_rate"]
        cached["forecast"] = merged_forecast
    else:
        cached["forecast"] = dict(_DEFAULT_FORECAST)
    return cached


@router.post("/analyze/{ticker}")
async def analyze_ticker(ticker: str, request: AnalyzeRequest):
    ticker = normalize_ticker(ticker)
    if not is_valid_ticker(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")

    resolved_api_key = (request.api_key or "").strip() or PROVIDER_API_KEYS.get(request.provider, "")

    if not reader.get_sheet_names():
        raise HTTPException(
            status_code=404,
            detail="raw_data.xlsx not found. Run 'py main.py' first.",
        )

    # Fix 7: Prevent analyze while pipeline is running
    if is_pipeline_running():
        raise HTTPException(
            status_code=409,
            detail="Pipeline is currently running. Wait for it to complete before analyzing.",
        )

    # Prefer cache-first behavior for same-day reruns. If fresh cache is available,
    # serve it even without an API key to support fast, deterministic re-analysis.
    cached_assumptions = _load_cached(ticker, request.provider, request.deep_research)
    if cached_assumptions:
        cached_assumptions = _patch_forecast(deepcopy(cached_assumptions))

    if not cached_assumptions and not resolved_api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No API key available for provider '{request.provider}'. Add a key in Settings or configure it on the backend.",
        )

    async def event_stream():
        # Step 1: Return cached assumptions when available.
        if cached_assumptions:
            yield _sse("step", "Found cached analysis from today")
            yield _sse("result", cached_assumptions)
            return

        # Step 2: Load financial summary only when cache miss occurs
        yield _sse("step", "Loading financial data from raw_data.xlsx...")
        summary = extract_financial_summary(reader)

        # Step 3: Compute historical ratios for self-review
        historical_ratios: dict | None = None
        try:
            from config import PROJECT_DIR
            import sys as _sys
            if str(PROJECT_DIR) not in _sys.path:
                _sys.path.insert(0, str(PROJECT_DIR))
            from add_forecast_statements import compute_preset_assumptions, extract_base_year
            _income = reader.get_sheet_as_df("Raw_Income_Statement")
            _balance = reader.get_sheet_as_df("Raw_Balance_Sheet")
            _cashflow = reader.get_sheet_as_df("Raw_Cash_Flow")
            if _income is not None and _balance is not None and _cashflow is not None:
                _presets = compute_preset_assumptions(_income, _balance, _cashflow)
                _base = extract_base_year(_income, _balance, _cashflow)
                _rev = float(_base.get("total_revenue") or 0)
                _ebit = float(_base.get("ebit") or 0)
                _ebitda = float(_base.get("ebitda") or 0)
                historical_ratios = {
                    "cogs_pct_revenue": _presets.get("cogs_pct_revenue"),
                    "rnd_pct_revenue": _presets.get("rnd_pct_revenue"),
                    "sga_pct_revenue": _presets.get("sga_pct_revenue"),
                    "base_ebit_margin": (_ebit / _rev) if _rev > 0 else None,
                    "base_ebitda_margin": (_ebitda / _rev) if _rev > 0 else None,
                    "base_revenue": _rev if _rev > 0 else None,
                }
        except Exception as exc:
            logging.warning(
                "Failed to compute historical ratios for %s during analyze: %s",
                ticker,
                exc,
            )

        # Step 4: Run AI agent with progress streaming
        mode_label = "Deep Research" if request.deep_research else "Standard"
        provider_label = request.provider.title()
        yield _sse("step", f"Starting {provider_label} AI agent ({mode_label} mode)...")

        # Thread-safe queue bridges sync on_step callbacks to async SSE stream
        step_q: thread_queue.Queue[tuple[str, object]] = thread_queue.Queue()

        def on_step(message: str) -> None:
            step_q.put_nowait(("step", message))

        async def _run_agent() -> None:
            try:
                result = await run_valuation_agent(
                    ticker=ticker,
                    financial_summary=summary,
                    api_key=resolved_api_key,
                    provider=request.provider,
                    deep_research=request.deep_research,
                    on_step=on_step,
                    historical_ratios=historical_ratios,
                )
                step_q.put_nowait(("result", result))
            except Exception as e:
                step_q.put_nowait(("error", str(e)))

        task = asyncio.create_task(_run_agent())

        # Stream events from queue; send keepalive comments every 15s to
        # prevent browser/proxy from closing the idle SSE connection.
        while not task.done():
            try:
                kind, data = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(None, step_q.get, True, 15.0),
                    timeout=16.0,
                )
                if kind == "step":
                    yield _sse("step", data)
                elif kind == "result":
                    _save_cache(ticker, data, request.provider, request.deep_research)
                    yield _sse("step", "Assumptions generated with citations")
                    yield _sse("result", data)
                    return
                elif kind == "error":
                    yield _sse("error", data)
                    return
            except (asyncio.TimeoutError, thread_queue.Empty):
                yield ": keepalive\n\n"

        # Drain any items queued after the task finished
        while not step_q.empty():
            try:
                kind, data = step_q.get_nowait()
            except thread_queue.Empty:
                break
            if kind == "step":
                yield _sse("step", data)
            elif kind == "result":
                _save_cache(ticker, data, request.provider, request.deep_research)
                yield _sse("step", "Assumptions generated with citations")
                yield _sse("result", data)
                return
            elif kind == "error":
                yield _sse("error", data)
                return

    return StreamingResponse(event_stream(), media_type="text/event-stream")
