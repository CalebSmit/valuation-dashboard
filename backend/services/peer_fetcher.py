"""Fetches financial metrics for peer companies selected by the AI agent.

Lightweight yfinance calls — only the 8 fields the comps engine needs.
Runs after the AI agent picks peers, NOT during the main pipeline.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yfinance as yf

logger = logging.getLogger(__name__)

# Fields a peer must have *something* in. Empty dict means yfinance
# returned no data (delisted ticker, network failure, complete throttle).
# Anything else still produces useful comps signal even if some metrics
# are None — a market cap alone supports P/E and P/B for the multiples
# table.
_USEFUL_FIELDS = (
    "marketCap",
    "enterpriseValue",
    "salesTTM",
    "ebitdaTTM",
    "trailingPE",
    "stockholdersEquity",
    "profitMargin",
    "operatingMargin",
    "roe",
    "beta",
)


def _fetch_one(ticker: str, attempt_delay: float = 0.0) -> dict[str, Any] | None:
    """Fetch comps-relevant metrics for a single ticker.

    Returns None ONLY when yfinance returned no data at all (the request
    failed entirely). A partial record — e.g. market cap present but
    EBITDA missing — is still kept so the comps multiples table can
    show whatever signal is available.

    Previously this dropped any peer that lacked all of
    (enterpriseValue, marketCap, salesTTM, ebitdaTTM), which silently
    eliminated peers like financials (no EV/EBITDA) or rate-limited
    requests where only a couple fields came back.
    """
    if attempt_delay > 0:
        time.sleep(attempt_delay)

    try:
        info = yf.Ticker(ticker).info
    except Exception as exc:
        logger.warning("[PEER FETCH] %s — exception: %s", ticker, exc)
        return None

    if not info:
        logger.warning("[PEER FETCH] %s — empty info dict", ticker)
        return None

    record = {
        "ticker": ticker,
        "companyName": info.get("longName") or ticker,
        "marketCap": info.get("marketCap"),
        "pe": info.get("trailingPE"),
        "enterpriseValue": info.get("enterpriseValue"),
        "salesTTM": info.get("totalRevenue"),
        "ebitdaTTM": info.get("ebitda"),
        "stockholdersEquity": info.get("totalStockholderEquity"),
        "profitMargin": info.get("profitMargins"),
        "operatingMargin": info.get("operatingMargins"),
        "roe": info.get("returnOnEquity"),
        "debtToEquity": info.get("debtToEquity"),
        "beta": info.get("beta"),
    }

    # Only drop if literally every comps-useful field is missing —
    # i.e. yfinance handed back a stub with just identifiers and no
    # financials. That's the genuinely-useless case; everything else
    # contributes at least one usable multiple.
    has_any_signal = any(
        info.get(field) is not None for field in _USEFUL_FIELDS
    )
    if not has_any_signal:
        logger.warning("[PEER FETCH] %s — info has no useful financial fields", ticker)
        return None
    return record


def fetch_peer_metrics(tickers: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch comps-relevant metrics for a list of peer tickers.

    Returns a tuple ``(peers, failed_tickers)`` so the caller can warn
    when fewer peers loaded than were requested. Uses parallel fetching
    with a small per-worker stagger so 5 simultaneous Yahoo requests
    don't all collide on the same throttle bucket; typically completes
    in ~1–2 s for 4–5 tickers.
    """
    if not tickers:
        return [], []
    workers = min(len(tickers), 5)

    # Stagger the workers slightly so we don't fire 5 yfinance requests
    # in the exact same millisecond — Yahoo throttles aggressively when
    # it sees burst patterns. 0.2s spacing is enough to spread them
    # across the bucket window without noticeably increasing wall time.
    indexed = list(enumerate(tickers))

    def _worker(args: tuple[int, str]) -> dict[str, Any] | None:
        idx, t = args
        return _fetch_one(t, attempt_delay=0.2 * idx)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(_worker, indexed))

    peers: list[dict[str, Any]] = []
    failed: list[str] = []
    for ticker, record in zip(tickers, results):
        if record is None:
            failed.append(ticker)
        else:
            peers.append(record)
    return peers, failed
