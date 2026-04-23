from __future__ import annotations

import re

TICKER_PATTERN = re.compile(r"^[A-Z0-9]{1,5}([.-][A-Z0-9]{1,4})?$")


def normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def is_valid_ticker(ticker: str) -> bool:
    return bool(TICKER_PATTERN.fullmatch(normalize_ticker(ticker)))
