"""Fetches financial metrics for peer companies selected by the AI agent.

Lightweight yfinance calls — only the 8 fields the comps engine needs.
Runs after the AI agent picks peers, NOT during the main pipeline.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yfinance as yf


def _fetch_one(ticker: str) -> dict[str, Any] | None:
    """Fetch comps-relevant metrics for a single ticker.

    Returns None on failure (rate-limit, delisted, malformed) so callers
    can drop the peer instead of treating an all-None dict as a usable
    record. Previously the comps engine silently shrank the peer set
    every time yfinance hiccuped, with no user-visible warning.
    """
    try:
        info = yf.Ticker(ticker).info
    except Exception:
        return None

    if not info:
        return None

    record = {
        "ticker": ticker,
        "companyName": info.get("longName", ticker),
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

    # Drop the peer if it has no usable comps data — no enterprise value,
    # no sales, no EBITDA. An all-None record adds no signal to medians.
    has_signal = any(
        record.get(field) is not None
        for field in ("enterpriseValue", "marketCap", "salesTTM", "ebitdaTTM")
    )
    if not has_signal:
        return None
    return record


def fetch_peer_metrics(tickers: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch comps-relevant metrics for a list of peer tickers.

    Returns a tuple ``(peers, failed_tickers)`` so the caller can warn
    when fewer peers loaded than were requested. Uses parallel fetching;
    typically completes in ~1s for 4-5 tickers.
    """
    if not tickers:
        return [], []
    workers = min(len(tickers), 5)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(_fetch_one, tickers))

    peers: list[dict[str, Any]] = []
    failed: list[str] = []
    for ticker, record in zip(tickers, results):
        if record is None:
            failed.append(ticker)
        else:
            peers.append(record)
    return peers, failed
