"""Peer company data endpoint — fetches financial metrics for AI-selected peers."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.peer_fetcher import fetch_peer_metrics

router = APIRouter(tags=["peers"])


@router.get("/peers")
async def fetch_peers(tickers: str):
    """Fetch financial metrics for peer tickers (comma-separated).

    Called by the frontend after the AI agent selects comparable companies.
    Returns the 8 fields the comps engine needs per peer.
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        raise HTTPException(status_code=400, detail="No tickers provided")
    if len(ticker_list) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 peer tickers allowed")

    peers, failed = fetch_peer_metrics(ticker_list)
    return {
        "peers": peers,
        "failed_peers": failed,
        "requested": len(ticker_list),
        "loaded": len(peers),
    }
