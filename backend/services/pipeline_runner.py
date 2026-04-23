"""Self-contained financial data pipeline.

Fetches all data directly from yfinance, FRED (public CSV endpoint),
and Damodaran's website — no subprocess, no Excel model (.xlsm) required.

Writes raw_data.xlsx with the same sheet schema that the rest of the
backend (excel_reader, financial_summarizer, etc.) already expects.
"""
from __future__ import annotations

import asyncio
import math
from collections.abc import AsyncGenerator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date
from typing import Any

import numpy as np
import pandas as pd
import requests
import yfinance as yf

from config import RAW_DATA_PATH
from services.ticker_validation import is_valid_ticker, normalize_ticker

PIPELINE_TIMEOUT = 600  # seconds — kept for API compat

# Simple lock to prevent concurrent pipeline runs
_pipeline_running = False


def is_pipeline_running() -> bool:
    """Check if the data pipeline is currently executing."""
    return _pipeline_running


class PipelineError(Exception):
    pass


# ── FRED series map ────────────────────────────────────────────────────────────
# Maps human-readable description (used by financial_summarizer) → FRED series ID.
_FRED_SERIES: dict[str, str] = {
    "Federal Funds Rate (%)":              "FEDFUNDS",
    "3-Month Treasury Yield (%)":          "DGS3MO",
    "6-Month Treasury Yield (%)":          "DGS6MO",
    "1-Year Treasury Yield (%)":           "DGS1",
    "2-Year Treasury Yield (%)":           "DGS2",
    "5-Year Treasury Yield (%)":           "DGS5",
    "10-Year Treasury Yield (%)":          "DGS10",
    "20-Year Treasury Yield (%)":          "DGS20",
    "30-Year Treasury Yield (%)":          "DGS30",
    "CPI - All Urban Consumers (Index)":   "CPIAUCSL",
    "VIX Volatility Index":                "VIXCLS",
    "Real GDP Growth Rate (Annualized %)": "A191RL1Q225SBEA",
}


def _fetch_fred_value(series_id: str) -> float | None:
    """Fetch the latest observation for a FRED series (no API key needed)."""
    try:
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        lines = [ln for ln in resp.text.strip().split("\n") if ln and not ln.startswith("DATE")]
        # Walk backwards to find the most recent non-"." value
        for line in reversed(lines):
            parts = line.split(",")
            if len(parts) >= 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip())
    except Exception:
        pass
    return None


def _build_fred_sheet() -> pd.DataFrame:
    """Return a DataFrame matching the FRED_Economic_Data sheet schema."""
    rows = []
    for description, series_id in _FRED_SERIES.items():
        value = _fetch_fred_value(series_id)
        rows.append({
            "Series ID": series_id,
            "Description": description,
            "Latest Value": value,
            "Date": date.today().isoformat(),
        })
    return pd.DataFrame(rows)


def _safe(val: Any, fallback: Any = None) -> Any:
    if val is None:
        return fallback
    try:
        if isinstance(val, float) and math.isnan(val):
            return fallback
    except TypeError:
        pass
    return val


def _run_sync_pipeline(ticker: str, progress_cb: Any) -> None:
    """Synchronous pipeline — called from a thread so the async generator stays non-blocking."""
    progress_cb(f"[1/10] Fetching company info for {ticker}...")
    t = yf.Ticker(ticker)
    info = t.info or {}

    # ── About sheet ────────────────────────────────────────────────────────────
    about_data = {
        "Symbol":           _safe(info.get("symbol"), ticker),
        "Company Name":     _safe(info.get("longName"), ""),
        "Sector":           _safe(info.get("sector"), ""),
        "Industry":         _safe(info.get("industry"), ""),
        "Business Summary": _safe(info.get("longBusinessSummary"), ""),
        "Current Price":    _safe(info.get("currentPrice") or info.get("regularMarketPrice")),
        "Market Cap":       _safe(info.get("marketCap")),
        "Country":          _safe(info.get("country"), ""),
        "Website":          _safe(info.get("website"), ""),
        "Employees":        _safe(info.get("fullTimeEmployees")),
    }
    about_df = pd.DataFrame(list(about_data.items()), columns=["Field", "Value"])

    # ── Valuation Data sheet ───────────────────────────────────────────────────
    progress_cb("[2/10] Fetching valuation metrics...")
    valuation_data = {
        "Market Cap":          _safe(info.get("marketCap")),
        "Enterprise Value":    _safe(info.get("enterpriseValue")),
        "PE Ratio (TTM)":      _safe(info.get("trailingPE")),
        "Forward PE":          _safe(info.get("forwardPE")),
        "PB Ratio":            _safe(info.get("priceToBook")),
        "EV to EBITDA":        _safe(info.get("enterpriseToEbitda")),
        "EV to Revenue":       _safe(info.get("enterpriseToRevenue")),
        "Profit Margin":       _safe(info.get("profitMargins")),
        "Operating Margin":    _safe(info.get("operatingMargins")),
        "Gross Margin":        _safe(info.get("grossMargins")),
        "ROE":                 _safe(info.get("returnOnEquity")),
        "ROA":                 _safe(info.get("returnOnAssets")),
        "Debt to Equity":      _safe(info.get("debtToEquity")),
        "Current Ratio":       _safe(info.get("currentRatio")),
        "Beta":                _safe(info.get("beta")),
        "52 Week High":        _safe(info.get("fiftyTwoWeekHigh")),
        "52 Week Low":         _safe(info.get("fiftyTwoWeekLow")),
        "Shares Outstanding":  _safe(info.get("sharesOutstanding")),
        "Dividend Yield":      _safe(info.get("dividendYield") or info.get("trailingAnnualDividendYield")),
        "Dividend Rate":       _safe(info.get("dividendRate") or info.get("trailingAnnualDividendRate")),
        "Payout Ratio":        _safe(info.get("payoutRatio")),
    }
    valuation_df = pd.DataFrame(list(valuation_data.items()), columns=["Metric", "Value"])

    # ── Financial statements (annual) ──────────────────────────────────────────
    progress_cb("[3/10] Fetching annual financial statements...")

    def _stmt_to_df(stmt: pd.DataFrame | None) -> pd.DataFrame:
        """Convert yfinance statement (index=accounts, cols=dates) → rows=years, cols=accounts."""
        if stmt is None or stmt.empty:
            return pd.DataFrame()
        df = stmt.T.copy()
        df.index.name = "Fiscal Year End"
        df = df.reset_index()
        df["Fiscal Year End"] = pd.to_datetime(df["Fiscal Year End"]).dt.strftime("%Y-%m-%d")
        # Normalize column names to snake_case for compatibility with financial_summarizer
        df.columns = [
            c if c == "Fiscal Year End"
            else c.lower().replace(" ", "_").replace("-", "_").replace("/", "_")
            for c in df.columns
        ]
        return df

    income_df    = _stmt_to_df(t.financials)
    balance_df   = _stmt_to_df(t.balance_sheet)
    cashflow_df  = _stmt_to_df(t.cashflow)

    # Quarterly statements
    q_income_df   = _stmt_to_df(t.quarterly_financials)
    q_balance_df  = _stmt_to_df(t.quarterly_balance_sheet)
    q_cashflow_df = _stmt_to_df(t.quarterly_cashflow)

    # ── Shares Outstanding ─────────────────────────────────────────────────────
    shares_val = _safe(info.get("sharesOutstanding"))
    shares_df = pd.DataFrame({
        "Date": [date.today().isoformat()],
        "Shares Outstanding": [shares_val],
    })

    # ── Analyst estimates ──────────────────────────────────────────────────────
    progress_cb("[4/10] Fetching analyst estimates...")

    def _reset_period_index(df: pd.DataFrame | None) -> pd.DataFrame:
        if df is None or df.empty:
            return pd.DataFrame()
        df = df.copy().reset_index()
        if "period" not in df.columns and df.columns[0] != "period":
            df = df.rename(columns={df.columns[0]: "period"})
        df["period"] = df["period"].astype(str)
        return df

    earnings_est_df  = _reset_period_index(t.earnings_estimate)
    revenue_est_df   = _reset_period_index(t.revenue_estimate)
    eps_trend_df     = _reset_period_index(t.eps_trend)

    # Growth forecasts (stock vs index)
    try:
        gf = t.growth_estimates
        if gf is not None and not gf.empty:
            gf = gf.reset_index()
            gf = gf.rename(columns={gf.columns[0]: "period"})
            # Keep stockTrend = ticker col, indexTrend = '^GSPC' or 'Industry' col
            ticker_upper = ticker.upper()
            stock_col = ticker_upper if ticker_upper in gf.columns else (gf.columns[1] if len(gf.columns) > 1 else None)
            index_col = next((c for c in gf.columns if c in ("^GSPC", "Industry", "S&P 500 (.INX)")), None)
            if stock_col and index_col:
                growth_df = pd.DataFrame({
                    "period": gf["period"],
                    "stockTrend": gf[stock_col],
                    "indexTrend": gf[index_col],
                })
            else:
                growth_df = pd.DataFrame()
        else:
            growth_df = pd.DataFrame()
    except Exception:
        growth_df = pd.DataFrame()

    # Earnings surprise history
    try:
        eh = t.earnings_history
        if eh is not None and not eh.empty:
            eh = eh.copy().reset_index()
            # Rename index col to 'quarter'
            if eh.columns[0] not in ("quarter",):
                eh = eh.rename(columns={eh.columns[0]: "quarter"})
            eh["quarter"] = pd.to_datetime(eh["quarter"], errors="coerce").dt.strftime("%Y-%m-%d")
            earnings_hist_df = eh
        else:
            earnings_hist_df = pd.DataFrame()
    except Exception:
        earnings_hist_df = pd.DataFrame()

    # Analyst ratings (recommendations summary)
    try:
        rs = t.recommendations_summary
        if rs is not None and not rs.empty:
            # Pivot to a Metric/Value format for financial_summarizer compatibility
            latest = rs.iloc[0] if len(rs) > 0 else None
            if latest is not None:
                ratings_rows = [
                    ("strongBuy",   _safe(latest.get("strongBuy"))),
                    ("buy",         _safe(latest.get("buy"))),
                    ("hold",        _safe(latest.get("hold"))),
                    ("sell",        _safe(latest.get("sell"))),
                    ("strongSell",  _safe(latest.get("strongSell"))),
                ]
                analyst_ratings_df = pd.DataFrame(ratings_rows, columns=["Metric", "Value"])
            else:
                analyst_ratings_df = pd.DataFrame()
        else:
            analyst_ratings_df = pd.DataFrame()
    except Exception:
        analyst_ratings_df = pd.DataFrame()

    # Additional metrics
    additional_rows = [
        ("PEG Ratio",       _safe(info.get("pegRatio"))),
        ("Forward EPS",     _safe(info.get("forwardEps"))),
        ("Trailing EPS",    _safe(info.get("trailingEps"))),
        ("Book Value",      _safe(info.get("bookValue"))),
        ("Price to Sales",  _safe(info.get("priceToSalesTrailing12Months"))),
        ("Revenue TTM",     _safe(info.get("totalRevenue"))),
        ("EBITDA TTM",      _safe(info.get("ebitda"))),
        ("Operating CF",    _safe(info.get("operatingCashflow"))),
        ("Free Cash Flow",  _safe(info.get("freeCashflow"))),
    ]
    additional_df = pd.DataFrame(additional_rows, columns=["Metric", "Value"])

    # ── Dividend history ───────────────────────────────────────────────────────
    progress_cb("[5/10] Fetching dividend history...")
    try:
        divs = t.dividends
        if divs is not None and not divs.empty:
            div_df = divs.reset_index().copy()
            div_df.columns = ["Date", "Dividend"]
            div_df["Date"] = pd.to_datetime(div_df["Date"]).dt.strftime("%Y-%m-%d")
            # Compute annual total (used by financial_summarizer _derive_annual_dividend_rate)
            div_df["_year"] = pd.to_datetime(div_df["Date"]).dt.year
            year_totals = div_df.groupby("_year")["Dividend"].sum().rename("Annual Total")
            div_df = div_df.merge(year_totals, on="_year", how="left")
            div_df = div_df.drop(columns=["_year"]).sort_values("Date", ascending=False)
            dividend_history_df = div_df
        else:
            dividend_history_df = pd.DataFrame()
    except Exception:
        dividend_history_df = pd.DataFrame()

    # DDM Metrics sheet
    annual_div_rate = _safe(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
    div_yield_pct   = (_safe(info.get("trailingAnnualDividendYield"), 0.0) or 0.0) * 100
    payout_ratio    = _safe(info.get("payoutRatio"), 0.0)
    # Compute years of dividend history
    years_div_hist: int | None = None
    if dividend_history_df is not None and not dividend_history_df.empty:
        years_set = pd.to_datetime(dividend_history_df["Date"], errors="coerce").dt.year.dropna().unique()
        years_div_hist = int(years_set.max() - years_set.min() + 1) if len(years_set) > 0 else 0

    # Dividend growth via CAGR over 3 & 5 years from dividend history
    def _div_cagr(years: int) -> float | None:
        if dividend_history_df is None or dividend_history_df.empty:
            return None
        try:
            tmp = dividend_history_df.copy()
            tmp["_year"] = pd.to_datetime(tmp["Date"], errors="coerce").dt.year
            annual = tmp.groupby("_year")["Dividend"].sum()
            annual = annual.sort_index()
            if len(annual) < years + 1:
                return None
            start = annual.iloc[-(years + 1)]
            end = annual.iloc[-1]
            if start <= 0:
                return None
            return ((end / start) ** (1 / years) - 1) * 100
        except Exception:
            return None

    ddm_rows = [
        ("Annual Dividend Rate",    annual_div_rate),
        ("Current Dividend Yield",  div_yield_pct),
        ("Payout Ratio",            (payout_ratio or 0.0) * 100),
        ("5-Year CAGR %",           _div_cagr(5)),
        ("3-Year CAGR %",           _div_cagr(3)),
        ("Years of Dividend History", years_div_hist),
        ("Payment Frequency",       "Quarterly" if (dividend_history_df is not None and not dividend_history_df.empty) else "N/A"),
    ]
    ddm_df = pd.DataFrame(ddm_rows, columns=["Metric", "Value"])

    # ── Stock price history ────────────────────────────────────────────────────
    progress_cb("[6/10] Fetching price history & computing beta...")
    try:
        history_raw = t.history(period="5y", interval="1d", auto_adjust=True)
        if not history_raw.empty:
            history_raw = history_raw.reset_index()
            history_raw["Date"] = pd.to_datetime(history_raw["Date"]).dt.strftime("%Y-%m-%d")
            history_raw["Ticker"] = ticker.upper()
            history_raw["Daily_Return_%"] = history_raw["Close"].pct_change() * 100
            stock_history_df = history_raw[["Ticker", "Date", "Open", "High", "Low", "Close", "Volume", "Daily_Return_%"]]
        else:
            stock_history_df = pd.DataFrame()
    except Exception:
        stock_history_df = pd.DataFrame()

    # ── Beta regression (5yr weekly vs SPY) ───────────────────────────────────
    try:
        spy_hist = yf.download("SPY", period="5y", interval="1wk", auto_adjust=True, progress=False)["Close"]
        ticker_hist = yf.download(ticker, period="5y", interval="1wk", auto_adjust=True, progress=False)["Close"]

        # Flatten MultiIndex if present (yfinance 0.2.x sometimes returns one)
        if hasattr(spy_hist, "columns"):
            spy_hist = spy_hist.iloc[:, 0]
        if hasattr(ticker_hist, "columns"):
            ticker_hist = ticker_hist.iloc[:, 0]

        stock_ret = ticker_hist.pct_change().dropna()
        spy_ret   = spy_hist.pct_change().dropna()
        combined  = pd.concat([stock_ret, spy_ret], axis=1).dropna()
        combined.columns = ["stock", "spy"]

        cov_matrix = np.cov(combined["stock"], combined["spy"])
        regression_beta = cov_matrix[0, 1] / cov_matrix[1, 1]
        r_squared = np.corrcoef(combined["stock"], combined["spy"])[0, 1] ** 2

        beta_rows = [
            ("BETA (Slope)",  round(regression_beta, 4)),
            ("R-SQUARED",     round(r_squared, 4)),
            ("Observations",  len(combined)),
        ]
        beta_df = pd.DataFrame(beta_rows, columns=["Metric", "Value"])
    except Exception:
        # Fall back to yfinance beta from info
        fallback_beta = _safe(info.get("beta"))
        beta_df = pd.DataFrame([
            ("BETA (Slope)",  fallback_beta),
            ("R-SQUARED",     None),
            ("Observations",  None),
        ], columns=["Metric", "Value"])

    # ── Relative Valuation (subject company metrics for comps) ────────────────
    # This sheet historically contained competitor rows — the AI agent now selects
    # peers via /api/peers. We populate it with the subject company only so
    # financial_summarizer can extract the ticker without errors.
    rel_val_df = pd.DataFrame([{
        "Ticker":              ticker.upper(),
        "Company Name":        _safe(info.get("longName"), ticker),
        "Market Cap":          _safe(info.get("marketCap")),
        "PE Ratio (TTM)":      _safe(info.get("trailingPE")),
        "Enterprise Value":    _safe(info.get("enterpriseValue")),
        "Sales (TTM)":         _safe(info.get("totalRevenue")),
        "EBITDA (TTM)":        _safe(info.get("ebitda")),
        "Stockholders Equity": _safe(info.get("bookValue")),
        "Profit Margin":       _safe(info.get("profitMargins")),
        "Operating Margin":    _safe(info.get("operatingMargins")),
        "ROE":                 _safe(info.get("returnOnEquity")),
        "Debt/Equity":         _safe(info.get("debtToEquity")),
        "Beta":                _safe(info.get("beta")),
    }])

    # ── FRED economic data ─────────────────────────────────────────────────────
    progress_cb("[7/10] Fetching FRED economic data...")
    fred_df = _build_fred_sheet()

    # ── EPS Revisions (alias of eps_trend with period index) ──────────────────
    eps_revisions_df = eps_trend_df.copy() if not eps_trend_df.empty else pd.DataFrame()

    # ── Placeholder sheets (kept for schema compat, populated where possible) ──
    progress_cb("[8/10] Fetching options & ownership data...")
    # Options implied volatility summary
    try:
        opts = t.option_chain(t.options[0]) if t.options else None
        if opts:
            iv_call = opts.calls["impliedVolatility"].mean() if "impliedVolatility" in opts.calls.columns else None
            iv_put  = opts.puts["impliedVolatility"].mean()  if "impliedVolatility" in opts.puts.columns  else None
            options_df = pd.DataFrame([
                ("Avg Call IV", iv_call),
                ("Avg Put IV",  iv_put),
            ], columns=["Metric", "Value"])
        else:
            options_df = pd.DataFrame()
    except Exception:
        options_df = pd.DataFrame()

    # Institutional holdings
    try:
        inst = t.institutional_holders
        institutional_df = inst if inst is not None and not inst.empty else pd.DataFrame()
    except Exception:
        institutional_df = pd.DataFrame()

    # Insider transactions
    try:
        insiders = t.insider_transactions
        insider_df = insiders if insiders is not None and not insiders.empty else pd.DataFrame()
    except Exception:
        insider_df = pd.DataFrame()

    # News
    try:
        news = t.news
        if news:
            news_rows = [{"Title": n.get("title",""), "Publisher": n.get("publisher",""), "Link": n.get("link","")} for n in news[:20]]
            news_df = pd.DataFrame(news_rows)
        else:
            news_df = pd.DataFrame()
    except Exception:
        news_df = pd.DataFrame()

    # ── Write raw_data.xlsx ────────────────────────────────────────────────────
    progress_cb("[9/10] Writing raw_data.xlsx...")

    sheet_map: dict[str, pd.DataFrame] = {
        "About":                    about_df,
        "Valuation Data":           valuation_df,
        "Raw_Income_Statement":     income_df,
        "Raw_Balance_Sheet":        balance_df,
        "Raw_Cash_Flow":            cashflow_df,
        "Quarterly_Income_Statement": q_income_df,
        "Quarterly_Balance_Sheet":  q_balance_df,
        "Quarterly_Cash_Flow":      q_cashflow_df,
        "Shares_Outstanding":       shares_df,
        "Earnings_Estimate":        earnings_est_df,
        "Revenue_Estimate":         revenue_est_df,
        "EPS_Trends":               eps_trend_df,
        "EPS_Revisions":            eps_revisions_df,
        "Growth_Forecasts":         growth_df,
        "Earnings_History":         earnings_hist_df,
        "Analyst_Ratings":          analyst_ratings_df,
        "Additional_Metrics":       additional_df,
        "Dividend_History":         dividend_history_df,
        "DDM_Metrics":              ddm_df,
        "Stock_History_Daily":      stock_history_df,
        "Beta Analysis":            beta_df,
        "Relative Valuation":       rel_val_df,
        "FRED_Economic_Data":       fred_df,
        "Options_Summary":          options_df,
        "Institutional_Holdings":   institutional_df,
        "Insider_Transactions":     insider_df,
        "News":                     news_df,
    }

    RAW_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(str(RAW_DATA_PATH), engine="openpyxl") as writer:
        for sheet_name, df in sheet_map.items():
            if df is not None and not df.empty:
                df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                # Write an empty placeholder so the sheet exists (avoids KeyErrors in readers)
                pd.DataFrame({"_empty": []}).to_excel(writer, sheet_name=sheet_name, index=False)

    progress_cb(f"[10/10] Pipeline complete — raw_data.xlsx written ({len(sheet_map)} sheets)")


async def run_pipeline(ticker: str, fred_api_key: str | None = None) -> AsyncGenerator[str, None]:
    """Fetch all financial data for *ticker* and write raw_data.xlsx.

    Yields progress messages suitable for SSE streaming.
    fred_api_key is accepted for API compatibility but not required —
    FRED data is fetched from the public CSV endpoint.
    """
    global _pipeline_running

    if _pipeline_running:
        raise PipelineError("Pipeline is already running. Wait for it to finish.")

    clean_ticker = normalize_ticker(ticker)
    if not is_valid_ticker(clean_ticker):
        raise PipelineError(f"Invalid ticker format: '{ticker}'")

    yield f"Starting pipeline for {clean_ticker}..."

    _pipeline_running = True
    messages: list[str] = []
    error: list[Exception] = []

    def progress_cb(msg: str) -> None:
        messages.append(msg)

    loop = asyncio.get_event_loop()

    def _run() -> None:
        try:
            _run_sync_pipeline(clean_ticker, progress_cb)
        except Exception as exc:
            error.append(exc)

    # Drain messages while the sync pipeline runs in a thread
    future = loop.run_in_executor(None, _run)
    last_sent = 0
    try:
        while not future.done():
            await asyncio.sleep(0.5)
            while last_sent < len(messages):
                yield messages[last_sent]
                last_sent += 1

        # Flush any remaining messages after completion
        await future  # re-raises if _run raised
        while last_sent < len(messages):
            yield messages[last_sent]
            last_sent += 1

        if error:
            raise PipelineError(str(error[0]))

    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(f"Pipeline failed: {exc}") from exc
    finally:
        _pipeline_running = False
