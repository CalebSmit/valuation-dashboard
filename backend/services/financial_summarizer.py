"""Extracts a compact financial summary from raw_data.xlsx sheets.

The summary serves dual purpose:
1. Sent to Claude as context for assumption generation (~2KB JSON)
2. Returned to frontend via GET /api/financials/summary for the overview
"""
from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any

import pandas as pd

from config import CACHE_DIR
from services.excel_reader import ExcelReader


_SUMMARY_CACHE_MTIME: float | None = None
_SUMMARY_CACHE_SIZE: int | None = None
_SUMMARY_CACHE_VALUE: dict[str, Any] | None = None
_SUMMARY_CACHE_LOCK = threading.Lock()
_SUMMARY_DISK_CACHE_PATH = CACHE_DIR / "financial_summary_cache.json"


def _load_disk_cached_summary(expected_mtime: float, expected_size: int) -> dict[str, Any] | None:
    """Load persisted summary cache only when raw_data signature still matches."""
    try:
        with open(_SUMMARY_DISK_CACHE_PATH, "r", encoding="utf-8") as cache_file:
            payload = json.load(cache_file)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None

    if not isinstance(payload, dict):
        return None

    cached_mtime = payload.get("raw_data_mtime")
    cached_size = payload.get("raw_data_size")
    cached_summary = payload.get("summary")
    if not isinstance(cached_summary, dict):
        return None

    if cached_mtime != expected_mtime or cached_size != expected_size:
        return None

    return cached_summary


def _save_disk_cached_summary(raw_data_mtime: float, raw_data_size: int, summary: dict[str, Any]) -> None:
    """Persist summary cache atomically to avoid partial writes/corruption."""
    payload = {
        "raw_data_mtime": raw_data_mtime,
        "raw_data_size": raw_data_size,
        "summary": summary,
    }
    tmp_path = Path(f"{_SUMMARY_DISK_CACHE_PATH}.tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as cache_file:
            json.dump(payload, cache_file, ensure_ascii=True)
        os.replace(tmp_path, _SUMMARY_DISK_CACHE_PATH)
    except OSError:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass


def _raw_data_signature(file_path: str) -> tuple[float | None, int | None]:
    """Return (mtime, size) signature for raw_data file, or (None, None) on failure."""
    try:
        return os.path.getmtime(file_path), os.path.getsize(file_path)
    except OSError:
        return None, None


def _safe_float(value: Any) -> float | None:
    if value is None or value == "N/A" or value == "":
        return None
    try:
        result = float(value)
        if pd.isna(result):
            return None
        return result
    except (ValueError, TypeError):
        return None


def _normalize_rate(value: float | None, likely_pct_threshold: float = 1.0) -> float | None:
    """Convert percentage-form rates to decimals. 4.06 -> 0.0406.
    Values > threshold are assumed to be in percentage form.
    Default threshold is 1.0 (anything above 100% is clearly a percentage)."""
    if value is None:
        return None
    if abs(value) > likely_pct_threshold:
        return value / 100.0
    return value


def _safe_float_div100(value: float | None) -> float | None:
    """Always divide by 100. For fields that are ALWAYS in percentage form (e.g., DDM yields, CAGRs)."""
    if value is None:
        return None
    return value / 100.0


def _normalize_pct_field(value: float | None) -> float | None:
    """For fields that are commonly 0-100 in source data (dividend yield, payout ratio, margins).
    yfinance stores these as decimals (0.312 = 31.2%) but some sheets store as percentages (31.2).
    Heuristic: if value > 1.5, it's almost certainly in percentage form.
    Previous threshold of 0.95 incorrectly divided values like 0.95 (95% payout ratio) by 100,
    turning them into 0.0095 and breaking DDM applicability for high-payout companies (REITs, utilities)."""
    if value is None:
        return None
    # Values above 1.5 are clearly in percentage form (no ratio exceeds 150% in decimal).
    # Values between 0 and 1.5 are already in decimal form.
    if abs(value) > 1.5:
        return value / 100.0
    return value


def _safe_str(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "N/A"
    return str(value)


_LABEL_COLUMN_HINTS = ("metric", "field", "description", "name", "item")


def _get_metric_value(df: pd.DataFrame, metric_name: str) -> Any:
    """Extract a value from a long-form DataFrame keyed by metric name.

    Works for About (Field/Value), Valuation Data (Metric/Value),
    DDM_Metrics (Metric/Value), and FRED (Description/Latest Value).

    The previous implementation used ``range(min(1, len(df.columns)))``
    which always evaluated to ``range(1)`` and only checked column 0.
    If a sheet ever shipped with an extra index column on the left
    (e.g. an unnamed pandas index), every lookup silently returned
    ``None`` — quietly breaking WACC/DDM/FRED inputs. This version
    searches by column name first, then falls back to scanning the
    first two columns for the literal label.
    """
    if df is None or df.empty:
        return None

    candidate_cols: list[int] = []
    for i, col in enumerate(df.columns):
        if any(hint in str(col).strip().lower() for hint in _LABEL_COLUMN_HINTS):
            candidate_cols.append(i)
    if not candidate_cols:
        candidate_cols = list(range(min(2, len(df.columns))))

    for col_idx in candidate_cols:
        matches = df[df.iloc[:, col_idx].astype(str).str.strip() == metric_name]
        if matches.empty:
            continue
        # Walk subsequent columns until we find a usable value
        for val_idx in range(col_idx + 1, len(matches.columns)):
            val = matches.iloc[0, val_idx]
            if val is not None and _safe_str(val) not in ("", "N/A", "Error"):
                return val
        if len(matches.columns) > col_idx + 1:
            return matches.iloc[0, col_idx + 1]
    return None


def _get_fred_value(df: pd.DataFrame, description: str) -> float | None:
    """Extract a value from the FRED sheet (Description / Latest Value format)."""
    if df is None or df.empty:
        return None
    # FRED sheet has: Series ID, Description, Latest Value, Date
    desc_col = None
    val_col = None
    for i, col in enumerate(df.columns):
        col_str = str(col).strip().lower()
        if "description" in col_str:
            desc_col = i
        elif "latest" in col_str or "value" in col_str:
            val_col = i
    if desc_col is None or val_col is None:
        return None
    matches = df[df.iloc[:, desc_col].astype(str).str.strip() == description]
    if matches.empty:
        return None
    return _safe_float(matches.iloc[0, val_col])


def _get_latest_annual_value(df: pd.DataFrame, field_name: str) -> float | None:
    """Get the most recent value for a column in a financial statement.
    Income/Balance/Cash flow sheets have fiscal years as ROWS and accounts as COLUMNS."""
    if df is None or df.empty:
        return None
    # Check if the field exists as a column name
    if field_name in df.columns:
        # First row is most recent year (newest first)
        val = _safe_float(df[field_name].iloc[0])
        if val is not None:
            return val
        # Try second row if first is None
        if len(df) > 1:
            return _safe_float(df[field_name].iloc[1])
    return None


def _get_annual_series(df: pd.DataFrame, field_name: str) -> list[dict[str, Any]]:
    """Get a time series of annual values for a column.
    Financial statements have years as rows, accounts as columns."""
    if df is None or df.empty:
        return []
    if field_name not in df.columns:
        return []
    result = []
    date_col = df.columns[0]  # First column is typically 'Fiscal Year End'
    for i in range(len(df)):
        year = str(df[date_col].iloc[i])[:4] if df[date_col].iloc[i] is not None else str(i)
        val = _safe_float(df[field_name].iloc[i])
        if val is not None:
            result.append({"year": year, "value": val})
    return result


def _extract_estimate_table(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """Extract analyst estimate rows (EPS or Revenue) into a list of period dicts."""
    if df is None or df.empty:
        return []
    result = []
    for _, row in df.iterrows():
        period = _safe_str(row.get("period", row.iloc[0] if len(row) > 0 else ""))
        entry: dict[str, Any] = {"period": period}
        for col in df.columns:
            col_str = str(col).lower()
            if col_str in ("period",):
                continue
            entry[str(col)] = _safe_float(row.get(col)) if col_str not in ("period",) else _safe_str(row.get(col))
        result.append(entry)
    return result


def _extract_growth_forecasts(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """Extract growth forecast rows (stock trend vs index trend)."""
    if df is None or df.empty:
        return []
    result = []
    for _, row in df.iterrows():
        result.append({
            "period": _safe_str(row.get("period", "")),
            "stockTrend": _safe_float(row.get("stockTrend")),
            "indexTrend": _safe_float(row.get("indexTrend")),
        })
    return result


def _extract_eps_trends(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """Extract EPS revision trends (current vs 7d/30d ago)."""
    if df is None or df.empty:
        return []
    result = []
    for _, row in df.iterrows():
        result.append({
            "period": _safe_str(row.get("period", "")),
            "current": _safe_float(row.get("current")),
            "7daysAgo": _safe_float(row.get("7daysAgo")),
            "30daysAgo": _safe_float(row.get("30daysAgo")),
        })
    return result


def _extract_earnings_history(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """Extract earnings surprise history."""
    if df is None or df.empty:
        return []
    result = []
    for _, row in df.iterrows():
        result.append({
            "quarter": _safe_str(row.get("quarter", "")),
            "epsActual": _safe_float(row.get("epsActual")),
            "epsEstimate": _safe_float(row.get("epsEstimate")),
            "epsDifference": _safe_float(row.get("epsDifference")),
            "surprisePercent": _safe_float(row.get("surprisePercent", row.get("surprise(%)"))),
        })
    return result


def _extract_analyst_ratings(df: pd.DataFrame | None) -> dict[str, Any]:
    """Extract analyst buy/hold/sell ratings."""
    if df is None or df.empty:
        return {}
    result: dict[str, Any] = {}
    for _, row in df.iterrows():
        metric = _safe_str(row.iloc[0])
        value = row.iloc[1] if len(row) > 1 else None
        result[metric] = _safe_float(value) if value is not None else None
    return result


def _extract_additional_metrics(df: pd.DataFrame | None) -> dict[str, Any]:
    """Extract additional metrics (PEG, forward EPS, etc.)."""
    if df is None or df.empty:
        return {}
    result: dict[str, Any] = {}
    for _, row in df.iterrows():
        metric = _safe_str(row.iloc[0])
        value = row.iloc[1] if len(row) > 1 else None
        result[metric] = _safe_float(value) if value is not None else _safe_str(value)
    return result


def _extract_capital_structure(
    balance_df: pd.DataFrame | None,
    income_df: pd.DataFrame | None,
    market_cap: float | None,
) -> dict[str, Any]:
    """Derive capital structure metrics for WACC construction."""
    total_debt = _get_latest_annual_value(balance_df, "total_debt") or _get_latest_annual_value(balance_df, "Total Debt")
    total_equity_book = _get_latest_annual_value(balance_df, "stockholders_equity") or _get_latest_annual_value(balance_df, "Stockholders Equity")
    interest_expense = _get_latest_annual_value(income_df, "interest_expense") or _get_latest_annual_value(income_df, "Interest Expense")

    # Market-value weights (CFA standard)
    equity_market = market_cap
    debt_market = total_debt  # Approximate book = market for debt
    total_capital = (equity_market or 0) + (debt_market or 0)

    implied_cost_of_debt: float | None = None
    if total_debt and total_debt > 0 and interest_expense:
        implied_cost_of_debt = abs(interest_expense) / total_debt

    return {
        "totalDebt": total_debt,
        "totalEquityBook": total_equity_book,
        "equityMarketValue": equity_market,
        "interestExpense": interest_expense,
        "impliedCostOfDebt": implied_cost_of_debt,
        "debtToCapitalMarket": (debt_market / total_capital) if total_capital and total_capital > 0 else None,
        "equityToCapitalMarket": (equity_market / total_capital) if total_capital and equity_market and total_capital > 0 else None,
    }


def _derive_annual_dividend_rate(
    excel_reader: ExcelReader,
    current_price: float | None,
    dividend_yield: float | None,
) -> float | None:
    """Derive annual dividend rate when DDM_Metrics sheet has N/A.
    Try Dividend_History sheet first, then fall back to price * yield."""
    # Try Dividend_History sheet — most recent COMPLETE year's annual total.
    # Sheet is sorted newest-first. The first row may be an incomplete year
    # (e.g., only 1 dividend in Q1 of current year). Find the first year
    # with 3+ dividend entries (quarterly) to get a complete annual total.
    div_df = excel_reader.get_sheet_as_df("Dividend_History")
    if div_df is not None and not div_df.empty and "Annual Total" in div_df.columns:
        div_df = div_df.copy()
        div_df["_date"] = pd.to_datetime(div_df["Date"], errors="coerce")
        div_df["_year"] = div_df["_date"].dt.year
        year_counts = div_df.groupby("_year").size()
        # Find most recent year with 3+ payments (complete year)
        complete_years = year_counts[year_counts >= 3].index
        if len(complete_years) > 0:
            latest_complete = max(complete_years)
            rows = div_df[div_df["_year"] == latest_complete]
            val = _safe_float(rows["Annual Total"].dropna().iloc[0])
            if val is not None and val > 0:
                return val

    # Fallback: current_price * dividend_yield
    if current_price and dividend_yield and dividend_yield > 0:
        return round(current_price * dividend_yield, 4)

    return None


def _extract_price_history_and_metrics(
    excel_reader: ExcelReader,
    ticker: str,
    risk_free_rate: float | None,
    beta: float | None,
) -> dict[str, Any]:
    """Extract stock price history, period returns, and risk-adjusted metrics
    from the Stock_History_Daily sheet."""
    import math
    from datetime import datetime, timedelta

    history_df = excel_reader.get_sheet_as_df("Stock_History_Daily")
    if history_df is None or history_df.empty:
        return {"stockPriceHistory": [], "periodReturns": None, "riskMetrics": None}

    # Normalize ticker column for matching
    history_df["Ticker"] = history_df["Ticker"].astype(str).str.strip().str.upper()
    ticker_upper = ticker.strip().upper()

    # Filter for subject ticker
    ticker_df = history_df[history_df["Ticker"] == ticker_upper].copy()

    # Fallback: if ticker is UNKNOWN or not found, infer from the sheet.
    # The subject ticker is the first non-SPY ticker in Stock_History_Daily
    # (pipeline always prepends subject ticker before competitors).
    if ticker_df.empty:
        all_tickers = [t for t in history_df["Ticker"].unique() if t != "SPY"]
        if all_tickers:
            ticker_upper = all_tickers[0]
            ticker_df = history_df[history_df["Ticker"] == ticker_upper].copy()

    if ticker_df.empty:
        return {"stockPriceHistory": [], "periodReturns": None, "riskMetrics": None}

    ticker_df["Date"] = pd.to_datetime(ticker_df["Date"])
    ticker_df = ticker_df.sort_values("Date").reset_index(drop=True)
    ticker_df["Close"] = pd.to_numeric(ticker_df["Close"], errors="coerce")

    # Build price history for chart (downsample to weekly for performance)
    # Take every 5th trading day to get ~250 points per year
    downsampled = ticker_df.iloc[::5].copy()
    # Always include the last data point
    if len(ticker_df) > 0 and (len(downsampled) == 0 or downsampled.iloc[-1]["Date"] != ticker_df.iloc[-1]["Date"]):
        downsampled = pd.concat([downsampled, ticker_df.iloc[[-1]]], ignore_index=True)

    price_history = [
        {"date": row["Date"].strftime("%Y-%m-%d"), "close": round(row["Close"], 2)}
        for _, row in downsampled.iterrows()
        if pd.notna(row["Close"])
    ]

    # --- Period returns ---
    now = ticker_df["Date"].max()
    first_close = ticker_df["Close"].iloc[0]
    last_close = ticker_df["Close"].iloc[-1]

    def _cagr(start_price: float, end_price: float, years: float) -> float | None:
        if start_price <= 0 or end_price <= 0 or years <= 0:
            return None
        return (end_price / start_price) ** (1.0 / years) - 1.0

    def _simple_return(start_price: float, end_price: float) -> float | None:
        if start_price <= 0:
            return None
        return (end_price - start_price) / start_price

    def _get_price_at_or_after(df: pd.DataFrame, target_date: pd.Timestamp) -> float | None:
        mask = df["Date"] >= target_date
        if mask.any():
            return float(df.loc[mask, "Close"].iloc[0])
        return None

    period_returns: dict[str, float | None] = {}

    # YTD
    ytd_start = pd.Timestamp(now.year, 1, 1)
    ytd_price = _get_price_at_or_after(ticker_df, ytd_start)
    period_returns["ytd"] = _simple_return(ytd_price, last_close) if ytd_price else None

    # 1Y
    one_yr_start = now - pd.DateOffset(years=1)
    one_yr_price = _get_price_at_or_after(ticker_df, one_yr_start)
    period_returns["oneYear"] = _cagr(one_yr_price, last_close, 1.0) if one_yr_price else None

    # Allow 30-day tolerance for data start date (market holidays can shift it)
    tolerance = pd.Timedelta(days=30)

    # 3Y
    three_yr_start = now - pd.DateOffset(years=3)
    three_yr_price = _get_price_at_or_after(ticker_df, three_yr_start)
    if three_yr_price and ticker_df["Date"].min() <= three_yr_start + tolerance:
        years_elapsed = (now - three_yr_start).days / 365.25
        period_returns["threeYear"] = _cagr(three_yr_price, last_close, years_elapsed)
    else:
        period_returns["threeYear"] = None

    # 5Y
    five_yr_start = now - pd.DateOffset(years=5)
    five_yr_price = _get_price_at_or_after(ticker_df, five_yr_start)
    if five_yr_price and ticker_df["Date"].min() <= five_yr_start + tolerance:
        years_elapsed = (now - five_yr_start).days / 365.25
        period_returns["fiveYear"] = _cagr(five_yr_price, last_close, years_elapsed)
    else:
        period_returns["fiveYear"] = None

    # --- Risk metrics ---
    daily_returns = pd.to_numeric(ticker_df["Daily_Return_%"], errors="coerce").dropna() / 100.0

    if len(daily_returns) < 30:
        return {"stockPriceHistory": price_history, "periodReturns": period_returns, "riskMetrics": None}

    # Annualized volatility
    ann_vol = float(daily_returns.std() * math.sqrt(252))

    # Annualized return (geometric mean from daily returns)
    cumulative = (1 + daily_returns).prod()
    trading_days = len(daily_returns)
    ann_return = cumulative ** (252.0 / trading_days) - 1.0 if trading_days > 0 else None

    # Risk-free rate fallback
    rf = risk_free_rate if risk_free_rate is not None else 0.04

    risk_metrics: dict[str, float | None] = {
        "annualizedVolatility": round(ann_vol, 4),
    }

    # Sharpe ratio: (annualized return - Rf) / annualized volatility
    if ann_return is not None and ann_vol > 0:
        risk_metrics["sharpeRatio"] = round((ann_return - rf) / ann_vol, 2)
    else:
        risk_metrics["sharpeRatio"] = None

    # Treynor ratio: (annualized return - Rf) / beta
    if ann_return is not None and beta and beta != 0:
        risk_metrics["treynorRatio"] = round((ann_return - rf) / beta, 4)
    else:
        risk_metrics["treynorRatio"] = None

    # Sortino ratio: (annualized return - Rf) / downside deviation
    negative_returns = daily_returns[daily_returns < 0]
    if len(negative_returns) > 0 and ann_return is not None:
        downside_dev = float(negative_returns.std() * math.sqrt(252))
        if downside_dev > 0:
            risk_metrics["sortinoRatio"] = round((ann_return - rf) / downside_dev, 2)
        else:
            risk_metrics["sortinoRatio"] = None
    else:
        risk_metrics["sortinoRatio"] = None

    return {
        "stockPriceHistory": price_history,
        "periodReturns": period_returns,
        "riskMetrics": risk_metrics,
    }


def extract_financial_summary(excel_reader: ExcelReader) -> dict[str, Any]:
    """Extract a compact financial summary from all raw_data.xlsx sheets."""
    global _SUMMARY_CACHE_MTIME, _SUMMARY_CACHE_SIZE, _SUMMARY_CACHE_VALUE

    current_mtime: float | None = None
    current_size: int | None = None
    with _SUMMARY_CACHE_LOCK:
        current_mtime, current_size = _raw_data_signature(excel_reader._file_path)
        if (
            current_mtime is not None
            and current_size is not None
            and _SUMMARY_CACHE_MTIME == current_mtime
            and _SUMMARY_CACHE_SIZE == current_size
            and _SUMMARY_CACHE_VALUE is not None
        ):
            return deepcopy(_SUMMARY_CACHE_VALUE)

    if current_mtime is not None and current_size is not None:
        disk_cached = _load_disk_cached_summary(current_mtime, current_size)
        if disk_cached is not None:
            with _SUMMARY_CACHE_LOCK:
                _SUMMARY_CACHE_MTIME = current_mtime
                _SUMMARY_CACHE_SIZE = current_size
                _SUMMARY_CACHE_VALUE = deepcopy(disk_cached)
            return deepcopy(disk_cached)

    # Load key sheets
    about_df = excel_reader.get_sheet_as_df("About")
    valuation_df = excel_reader.get_sheet_as_df("Valuation Data")
    income_df = excel_reader.get_sheet_as_df("Raw_Income_Statement")
    balance_df = excel_reader.get_sheet_as_df("Raw_Balance_Sheet")
    cashflow_df = excel_reader.get_sheet_as_df("Raw_Cash_Flow")
    ddm_df = excel_reader.get_sheet_as_df("DDM_Metrics")
    fred_df = excel_reader.get_sheet_as_df("FRED_Economic_Data")
    beta_df = excel_reader.get_sheet_as_df("Beta Analysis")
    relative_df = excel_reader.get_sheet_as_df("Relative Valuation")
    analyst_df = excel_reader.get_sheet_as_df("Earnings_Estimate")
    # Additional sheets for CFA-grade analysis
    revenue_est_df = excel_reader.get_sheet_as_df("Revenue_Estimate")
    growth_df = excel_reader.get_sheet_as_df("Growth_Forecasts")
    eps_trends_df = excel_reader.get_sheet_as_df("EPS_Trends")
    earnings_hist_df = excel_reader.get_sheet_as_df("Earnings_History")
    analyst_ratings_df = excel_reader.get_sheet_as_df("Analyst_Ratings")
    additional_df = excel_reader.get_sheet_as_df("Additional_Metrics")

    # Company info
    company_info = {}
    if about_df is not None and not about_df.empty:
        for _, row in about_df.iterrows():
            key = _safe_str(row.iloc[0])
            val = row.iloc[1] if len(row) > 1 else None
            company_info[key] = val

    # Valuation metrics
    def vm(name: str) -> float | None:
        return _safe_float(_get_metric_value(valuation_df, name))

    # FRED data extraction
    def fred(name: str) -> float | None:
        return _get_fred_value(fred_df, name)

    # Beta extraction
    def beta_val(name: str) -> float | None:
        return _safe_float(_get_metric_value(beta_df, name))

    # DDM extraction
    def ddm_val(name: str) -> float | None:
        return _safe_float(_get_metric_value(ddm_df, name))

    # Revenue history for growth calculation
    revenue_series = _get_annual_series(income_df, "total_revenue")
    if not revenue_series:
        revenue_series = _get_annual_series(income_df, "Total Revenue")

    ebitda_series = _get_annual_series(income_df, "ebitda")
    if not ebitda_series:
        ebitda_series = _get_annual_series(income_df, "EBITDA")

    # Competitor data from Relative Valuation
    competitors: list[dict[str, Any]] = []
    if relative_df is not None and not relative_df.empty:
        for _, row in relative_df.iterrows():
            ticker = _safe_str(row.get("Ticker", ""))
            if ticker and ticker != "N/A":
                competitors.append({
                    "ticker": ticker,
                    "companyName": _safe_str(row.get("Company Name", "")),
                    "marketCap": _safe_float(row.get("Market Cap")),
                    "pe": _safe_float(row.get("PE Ratio (TTM)")),
                    "enterpriseValue": _safe_float(row.get("Enterprise Value")),
                    "salesTTM": _safe_float(row.get("Sales (TTM)")),
                    "ebitdaTTM": _safe_float(row.get("EBITDA (TTM)")),
                    "stockholdersEquity": _safe_float(row.get("Stockholders Equity")),
                    "profitMargin": _safe_float(row.get("Profit Margin")),
                    "operatingMargin": _safe_float(row.get("Operating Margin")),
                    "roe": _safe_float(row.get("ROE")),
                    "debtToEquity": _safe_float(row.get("Debt/Equity")),
                    "beta": _safe_float(row.get("Beta")),
                })

    # Analyst estimates
    analyst_target_mean: float | None = None
    analyst_target_low: float | None = None
    analyst_target_high: float | None = None
    if analyst_df is not None and not analyst_df.empty:
        analyst_target_mean = _safe_float(_get_metric_value(analyst_df, "Mean"))
        analyst_target_low = _safe_float(_get_metric_value(analyst_df, "Low"))
        analyst_target_high = _safe_float(_get_metric_value(analyst_df, "High"))

    # Shares outstanding — from dedicated sheet (most recent quarterly value)
    shares_df = excel_reader.get_sheet_as_df("Shares_Outstanding")
    shares_outstanding: float | None = None
    if shares_df is not None and not shares_df.empty and "Shares Outstanding" in shares_df.columns:
        shares_outstanding = _safe_float(shares_df["Shares Outstanding"].iloc[-1])
    if shares_outstanding is None:
        shares_outstanding = vm("Shares Outstanding")

    # Beta — from Beta Analysis sheet (row-based: "BETA (Slope)" → value in col 1)
    regression_beta: float | None = None
    beta_r_squared: float | None = None
    if beta_df is not None and not beta_df.empty:
        for _, row in beta_df.iterrows():
            label = _safe_str(row.iloc[0])
            if "BETA" in label.upper() and "SLOPE" in label.upper():
                regression_beta = _safe_float(row.iloc[1])
            elif "R-SQUARED" in label.upper() and "EXPLANATION" not in label.upper():
                beta_r_squared = _safe_float(row.iloc[1])

    # Determine ticker from About sheet, then Relative Valuation, then fallback
    ticker = _safe_str(
        company_info.get("Symbol",
        company_info.get("Ticker", None))
    )
    if ticker == "N/A" and relative_df is not None and not relative_df.empty:
        ticker = _safe_str(relative_df.iloc[0].get("Ticker", "UNKNOWN"))
    elif ticker == "N/A":
        ticker = "UNKNOWN"

    result = {
        "ticker": ticker,
        "companyName": _safe_str(company_info.get("Company Name", company_info.get("longName", ""))),
        "sector": _safe_str(company_info.get("Sector", "")),
        "industry": _safe_str(company_info.get("Industry", "")),
        "businessSummary": _safe_str(company_info.get("Business Summary", ""))[:1500],
        "currentPrice": _safe_float(company_info.get("Current Price", company_info.get("currentPrice"))),
        "sharesOutstanding": shares_outstanding,

        # Valuation metrics
        "marketCap": vm("Market Cap"),
        "enterpriseValue": vm("Enterprise Value"),
        "peRatioTTM": vm("PE Ratio (TTM)"),
        "forwardPE": vm("Forward PE"),
        "pbRatio": vm("PB Ratio"),
        "evToEbitda": vm("EV to EBITDA"),
        "evToRevenue": vm("EV to Revenue"),
        # Margin / return ratios from the Valuation Data sheet are populated
        # by yfinance as decimals (0.312 = 31.2%). _normalize_rate's old
        # threshold of 1.0 incorrectly halved values like 1.02 (a real 102%
        # ratio during deferred-revenue or extreme-margin scenarios) or
        # mistakenly-percentage-form rows. _normalize_pct_field's 1.5
        # threshold preserves decimals up to 150% and still recovers from
        # stray percentage-form entries.
        "profitMargin": _normalize_pct_field(vm("Profit Margin")),
        "operatingMargin": _normalize_pct_field(vm("Operating Margin")),
        "roe": _normalize_pct_field(vm("ROE")),
        "roa": _normalize_pct_field(vm("ROA")),
        "debtToEquity": vm("Debt to Equity"),
        "currentRatio": vm("Current Ratio"),
        "beta": vm("Beta"),
        "fiftyTwoWeekHigh": vm("52 Week High"),
        "fiftyTwoWeekLow": vm("52 Week Low"),

        # Income statement history
        "revenueHistory": revenue_series,
        "ebitdaHistory": ebitda_series,
        "revenueLatest": _get_latest_annual_value(income_df, "total_revenue") or _get_latest_annual_value(income_df, "Total Revenue"),
        "grossMargin": _normalize_pct_field(vm("Gross Margin")),
        "operatingIncome": _get_latest_annual_value(income_df, "operating_income") or _get_latest_annual_value(income_df, "Operating Income"),

        # Balance sheet
        "totalDebt": _get_latest_annual_value(balance_df, "total_debt") or _get_latest_annual_value(balance_df, "Total Debt"),
        "totalCash": _get_latest_annual_value(balance_df, "cash_and_cash_equivalents") or _get_latest_annual_value(balance_df, "Cash And Cash Equivalents"),
        "totalEquity": _get_latest_annual_value(balance_df, "stockholders_equity") or _get_latest_annual_value(balance_df, "Stockholders Equity"),

        # Cash flow
        "operatingCashFlow": _get_latest_annual_value(cashflow_df, "operating_cash_flow") or _get_latest_annual_value(cashflow_df, "Operating Cash Flow"),
        "capex": _get_latest_annual_value(cashflow_df, "capital_expenditure") or _get_latest_annual_value(cashflow_df, "Capital Expenditure"),
        "freeCashFlow": _get_latest_annual_value(cashflow_df, "free_cash_flow") or _get_latest_annual_value(cashflow_df, "Free Cash Flow"),
        "interestExpense": _get_latest_annual_value(income_df, "interest_expense") or _get_latest_annual_value(income_df, "Interest Expense"),
        "netBorrowing": _get_latest_annual_value(cashflow_df, "net_issuance_payments_of_debt") or _get_latest_annual_value(cashflow_df, "Net Issuance Payments Of Debt"),

        # DDM metrics — DDM_Metrics sheet stores yields/CAGRs in percentage form
        # (e.g., 2.34 = 2.34%), but Valuation Data (yfinance) stores as decimal (0.0234).
        # _safe_float_div100 is correct for DDM_Metrics sheet values.
        # vm() fallback values from Valuation Data are already decimal — use _normalize_pct_field.
        "dividendYield": _safe_float_div100(ddm_val("Current Dividend Yield")) if ddm_val("Current Dividend Yield") is not None else _normalize_pct_field(vm("Dividend Yield")),
        "annualDividendRate": ddm_val("Annual Dividend Rate") or _derive_annual_dividend_rate(excel_reader, _safe_float(company_info.get("Current Price", company_info.get("currentPrice"))), _safe_float_div100(ddm_val("Current Dividend Yield")) if ddm_val("Current Dividend Yield") is not None else _normalize_pct_field(vm("Dividend Yield"))),
        "payoutRatio": _normalize_pct_field(ddm_val("Payout Ratio") or vm("Payout Ratio")),
        "dividendGrowth5yr": _safe_float_div100(ddm_val("5-Year CAGR %")),
        "dividendGrowth3yr": _safe_float_div100(ddm_val("3-Year CAGR %")),
        "yearsOfDividendHistory": ddm_val("Years of Dividend History"),
        "paymentFrequency": _safe_str(_get_metric_value(ddm_df, "Payment Frequency")) if ddm_df is not None else "N/A",

        # Beta analysis
        "regressionBeta": regression_beta or vm("Beta"),
        "betaRSquared": beta_r_squared,
        "betaStdError": None,

        # FRED economic data (normalized to decimal: 4.06% -> 0.0406)
        "riskFreeRate10yr": _normalize_rate(fred("10-Year Treasury Yield (%)")),
        "riskFreeRate5yr": _normalize_rate(fred("5-Year Treasury Yield (%)")),
        "fedFundsRate": _normalize_rate(fred("Federal Funds Rate (%)")),
        "cpi": fred("CPI - All Urban Consumers (Index)"),  # Index, not rate — no normalization
        "vix": fred("VIX Volatility Index"),  # Level, not rate — no normalization
        "realGDPGrowth": _normalize_rate(fred("Real GDP Growth Rate (Annualized %)")),

        # Competitors
        "competitors": competitors,

        # Analyst estimates
        "analystTargetMean": analyst_target_mean,
        "analystTargetLow": analyst_target_low,
        "analystTargetHigh": analyst_target_high,

        # --- CFA-grade enrichment (from enhancement sheets) ---

        # Analyst EPS estimates by period
        "analystEPSEstimates": _extract_estimate_table(analyst_df),

        # Analyst revenue estimates by period
        "analystRevenueEstimates": _extract_estimate_table(revenue_est_df),

        # Growth forecasts (stock vs index trend)
        "growthForecasts": _extract_growth_forecasts(growth_df),

        # EPS revision trends (are estimates being revised up or down?)
        "epsTrends": _extract_eps_trends(eps_trends_df),

        # Earnings surprise history
        "earningsHistory": _extract_earnings_history(earnings_hist_df),

        # Analyst buy/hold/sell ratings
        "analystRatings": _extract_analyst_ratings(analyst_ratings_df),

        # Additional metrics (PEG, forward EPS, etc.)
        "additionalMetrics": _extract_additional_metrics(additional_df),

        # Capital structure detail
        "capitalStructure": _extract_capital_structure(
            balance_df, income_df,
            _safe_float(company_info.get("Market Cap", company_info.get("marketCap"))),
        ),

        # Full FRED yield curve (normalized to decimal: 4.06% -> 0.0406)
        "yieldCurve": {
            "3mo": _normalize_rate(fred("3-Month Treasury Yield (%)")),
            "6mo": _normalize_rate(fred("6-Month Treasury Yield (%)")),
            "1yr": _normalize_rate(fred("1-Year Treasury Yield (%)")),
            "2yr": _normalize_rate(fred("2-Year Treasury Yield (%)")),
            "5yr": _normalize_rate(fred("5-Year Treasury Yield (%)")),
            "10yr": _normalize_rate(fred("10-Year Treasury Yield (%)")),
            "20yr": _normalize_rate(fred("20-Year Treasury Yield (%)")),
            "30yr": _normalize_rate(fred("30-Year Treasury Yield (%)")),
        },

        # D&A for proper EBIT-based tax calculation
        "depreciationAndAmortization": _get_latest_annual_value(cashflow_df, "depreciation_and_amortization") or _get_latest_annual_value(income_df, "reconciled_depreciation"),

        # Price history, period returns, and risk-adjusted metrics
        # (populated below via _extract_price_history_and_metrics)
    }

    # Extract price history and return/risk metrics
    price_metrics = _extract_price_history_and_metrics(
        excel_reader,
        ticker=ticker,
        risk_free_rate=_normalize_rate(fred("10-Year Treasury Yield (%)")),
        beta=vm("Beta"),
    )
    result.update(price_metrics)

    final_mtime, final_size = _raw_data_signature(excel_reader._file_path)
    if (
        current_mtime is not None
        and current_size is not None
        and final_mtime == current_mtime
        and final_size == current_size
    ):
        with _SUMMARY_CACHE_LOCK:
            _SUMMARY_CACHE_MTIME = current_mtime
            _SUMMARY_CACHE_SIZE = current_size
            _SUMMARY_CACHE_VALUE = deepcopy(result)
        _save_disk_cached_summary(current_mtime, current_size, result)

    return result
