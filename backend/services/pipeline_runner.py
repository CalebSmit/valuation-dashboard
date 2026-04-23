"""Runs the main.py financial data pipeline as a subprocess.

Writes the ticker to the Excel model's Input!C10 cell, then executes
`py main.py` and streams stdout line by line.
"""
from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import AsyncGenerator

# asyncio.create_subprocess_exec requires ProactorEventLoop on Windows.
# Set the policy at import time so it applies regardless of how uvicorn starts.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from pathlib import Path

from openpyxl import load_workbook

from config import PROJECT_DIR, FINANCIAL_TOOL_EXE_PATH, MODEL_PATH, PACKAGE_MODE
from services.ticker_validation import is_valid_ticker, normalize_ticker

MAIN_PY_PATH = PROJECT_DIR / "main.py"
PIPELINE_TIMEOUT = 600  # 10 minutes max

# Simple lock to prevent concurrent pipeline runs
_pipeline_running = False


def is_pipeline_running() -> bool:
    """Check if the data pipeline is currently executing."""
    return _pipeline_running


class PipelineError(Exception):
    pass


def write_ticker_to_model(ticker: str) -> None:
    """Write the ticker to Smit Financial Model.xlsm → Input!C10.

    Also clears competitor cells (F10, F12, F14, F16) so stale peers
    from a previous run don't contaminate the new analysis.
    """
    if not MODEL_PATH.exists():
        raise PipelineError(
            f"Smit Financial Model.xlsm not found at {MODEL_PATH}. "
            "Make sure the Excel model is in the project root."
        )

    try:
        wb = load_workbook(MODEL_PATH, keep_vba=True)
        sheet = wb["Input"]
        sheet["C10"] = ticker
        # Clear competitor cells to prevent stale peers from prior runs
        for cell in ("F10", "F12", "F14", "F16"):
            sheet[cell] = None
        wb.save(MODEL_PATH)
        wb.close()
    except PermissionError:
        raise PipelineError(
            "Cannot write to Smit Financial Model.xlsm — the file may be open in Excel. "
            "Close it and try again."
        )
    except KeyError:
        raise PipelineError(
            "The 'Input' sheet was not found in Smit Financial Model.xlsm."
        )


async def run_pipeline(ticker: str, fred_api_key: str | None = None) -> AsyncGenerator[str, None]:
    """Run `py main.py` and yield stdout lines as they arrive."""
    global _pipeline_running

    if _pipeline_running:
        raise PipelineError("Pipeline is already running. Wait for it to finish.")

    # Validate ticker
    clean_ticker = normalize_ticker(ticker)
    if not is_valid_ticker(clean_ticker):
        raise PipelineError(f"Invalid ticker format: '{ticker}'")

    if not MAIN_PY_PATH.exists():
        if not (PACKAGE_MODE and FINANCIAL_TOOL_EXE_PATH.exists()):
            raise PipelineError(f"main.py not found at {MAIN_PY_PATH}")

    # Pass ticker via CLI args (no Excel write needed — avoids file locking)
    yield f"Starting pipeline for {clean_ticker}..."

    _pipeline_running = True
    try:
        if PACKAGE_MODE and FINANCIAL_TOOL_EXE_PATH.exists():
            command = [str(FINANCIAL_TOOL_EXE_PATH), "--ticker", clean_ticker]
        else:
            python_cmd = "py" if os.name == "nt" else sys.executable
            command = [python_cmd, str(MAIN_PY_PATH), "--ticker", clean_ticker]

        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        if fred_api_key:
            env["FRED_API_KEY"] = fred_api_key

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(PROJECT_DIR),
            env=env,
        )

        try:
            while True:
                line = await asyncio.wait_for(
                    process.stdout.readline(),
                    timeout=PIPELINE_TIMEOUT,
                )
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").rstrip()
                if decoded:
                    yield decoded
        except asyncio.TimeoutError:
            process.kill()
            raise PipelineError("Pipeline timed out after 10 minutes")

        await process.wait()

        if process.returncode != 0:
            raise PipelineError(
                f"Pipeline exited with code {process.returncode}. Check the log above for errors."
            )

        yield "Pipeline complete — raw_data.xlsx updated"

    finally:
        _pipeline_running = False
