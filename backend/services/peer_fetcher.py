"""Fetches financial metrics for peer companies selected by the AI agent.

Lightweight yfinance calls — only the 8 fields the comps engine needs.
Runs after the AI agent picks peers, NOT during the main pipeline.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yfinance as yf


def _fetch_one(ticker: str) -> dict[str, Any]:
    """Fetch comps-relevant metrics for a single ticker."""
    try:
        info = yf.Ticker(ticker).info
        return {
            "ticker": ticker,
            "companyName": info.get("longName", "N/A"),
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
    except Exception:
        return {
            "ticker": ticker,
            "companyName": "N/A",
            "marketCap": None,
            "pe": None,
            "enterpriseValue": None,
            "salesTTM": None,
            "ebitdaTTM": None,
            "stockholdersEquity": None,
            "profitMargin": None,
            "operatingMargin": None,
            "roe": None,
            "debtToEquity": None,
            "beta": None,
        }


def fetch_peer_metrics(tickers: list[str]) -> list[dict[str, Any]]:
    """Fetch comps-relevant metrics for a list of peer tickers.

    Returns list of dicts matching the frontend CompetitorData shape.
    Uses parallel fetching — typically completes in ~1s for 4-5 tickers.
    """
    if not tickers:
        return []
    workers = min(len(tickers), 5)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        return list(executor.map(_fetch_one, tickers))
