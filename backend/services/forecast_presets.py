"""Compute forecast preset assumptions and base-year actuals from financial statements.

Self-contained replacement for the external add_forecast_statements module.
Derives sensible defaults from the last 3 years of income / balance / cash-flow
data so the AI agent has a historical baseline to anchor its projections.
"""
from __future__ import annotations

from typing import Any

import pandas as pd


def _safe(val: Any, fallback: float | None = None) -> float | None:
    """Return val as float or fallback if missing/NaN."""
    if val is None:
        return fallback
    try:
        result = float(val)
        if pd.isna(result):
            return fallback
        return result
    except (TypeError, ValueError):
        return fallback


def _col(df: pd.DataFrame, *names: str) -> pd.Series | None:
    """Return the first matching column (case-insensitive snake_case search)."""
    if df is None or df.empty:
        return None
    lower_map = {c.lower().replace(" ", "_").replace("-", "_"): c for c in df.columns}
    for name in names:
        key = name.lower().replace(" ", "_").replace("-", "_")
        if key in lower_map:
            return df[lower_map[key]]
        # Direct match
        if name in df.columns:
            return df[name]
    return None


def _latest(df: pd.DataFrame, *col_names: str) -> float | None:
    """Get the most recent (first row) value for a column."""
    col = _col(df, *col_names)
    if col is None or col.empty:
        return None
    return _safe(col.iloc[0])


def _avg_ratio(numerator: pd.Series | None, denominator: pd.Series | None, n: int = 3) -> float | None:
    """Average ratio of numerator/denominator over the last n periods."""
    if numerator is None or denominator is None:
        return None
    num = numerator.head(n).apply(_safe).dropna()
    den = denominator.head(n).apply(_safe).dropna()
    combined = pd.concat([num, den], axis=1).dropna()
    combined.columns = ["num", "den"]
    combined = combined[combined["den"].abs() > 0]
    if combined.empty:
        return None
    ratios = combined["num"] / combined["den"]
    return float(ratios.mean())


def compute_preset_assumptions(
    income_df: pd.DataFrame,
    balance_df: pd.DataFrame,
    cashflow_df: pd.DataFrame,
) -> dict[str, Any]:
    """Derive preset assumptions from historical financial statements.

    Returns a dict matching the shape expected by the AI agent:
    cogs_pct_revenue, rnd_pct_revenue, sga_pct_revenue, etc.
    """
    revenue = _col(income_df, "total_revenue", "Total Revenue", "Revenue")
    cogs    = _col(income_df, "cost_of_revenue", "Cost Of Revenue", "Cost of Goods Sold", "COGS")
    rnd     = _col(income_df, "research_development", "Research And Development", "R&D Expense")
    sga     = _col(income_df, "selling_general_administrative", "Selling General And Administration",
                   "Selling General Administrative", "SGA")
    ebitda  = _col(income_df, "ebitda", "EBITDA", "Normalized EBITDA")
    ebit    = _col(income_df, "ebit", "EBIT", "Operating Income", "operating_income")
    capex   = _col(cashflow_df, "capital_expenditure", "Capital Expenditure", "CapEx")
    dep_am  = _col(cashflow_df, "depreciation_and_amortization", "Reconciled Depreciation",
                   "Depreciation Amortization Depletion")
    nwc_chg = _col(cashflow_df, "change_in_working_capital", "Changes In Working Capital",
                   "Working Capital Changes")

    presets: dict[str, Any] = {
        "cogs_pct_revenue":    _avg_ratio(cogs,    revenue),
        "rnd_pct_revenue":     _avg_ratio(rnd,     revenue),
        "sga_pct_revenue":     _avg_ratio(sga,     revenue),
        "ebitda_pct_revenue":  _avg_ratio(ebitda,  revenue),
        "ebit_pct_revenue":    _avg_ratio(ebit,    revenue),
        "capex_pct_revenue":   _avg_ratio(capex,   revenue),
        "da_pct_revenue":      _avg_ratio(dep_am,  revenue),
        "nwc_chg_pct_revenue": _avg_ratio(nwc_chg, revenue),
    }

    # Revenue CAGR (most recent 3 years)
    if revenue is not None and len(revenue.dropna()) >= 2:
        rev_vals = revenue.dropna().apply(_safe).dropna()
        rev_vals = rev_vals[rev_vals > 0]
        if len(rev_vals) >= 2:
            # Most recent is index 0, oldest at end
            end_val   = float(rev_vals.iloc[0])
            start_val = float(rev_vals.iloc[min(2, len(rev_vals) - 1)])
            n_periods = min(2, len(rev_vals) - 1)
            if start_val > 0 and n_periods > 0:
                presets["revenue_cagr_3yr"] = (end_val / start_val) ** (1 / n_periods) - 1
            else:
                presets["revenue_cagr_3yr"] = None
        else:
            presets["revenue_cagr_3yr"] = None
    else:
        presets["revenue_cagr_3yr"] = None

    return presets


def extract_base_year(
    income_df: pd.DataFrame,
    balance_df: pd.DataFrame,
    cashflow_df: pd.DataFrame,
) -> dict[str, Any]:
    """Extract the most recent full-year actuals for DCF anchoring."""
    return {
        "total_revenue":     _latest(income_df,   "total_revenue",  "Total Revenue"),
        "ebit":              _latest(income_df,   "ebit",           "EBIT", "Operating Income"),
        "ebitda":            _latest(income_df,   "ebitda",         "EBITDA", "Normalized EBITDA"),
        "net_income":        _latest(income_df,   "net_income",     "Net Income"),
        "gross_profit":      _latest(income_df,   "gross_profit",   "Gross Profit"),
        "operating_income":  _latest(income_df,   "operating_income","Operating Income"),
        "total_assets":      _latest(balance_df,  "total_assets",   "Total Assets"),
        "total_debt":        _latest(balance_df,  "total_debt",     "Total Debt"),
        "stockholders_equity": _latest(balance_df, "stockholders_equity", "Stockholders Equity"),
        "cash_and_equivalents": _latest(balance_df, "cash_and_cash_equivalents", "Cash And Cash Equivalents"),
        "operating_cash_flow": _latest(cashflow_df, "operating_cash_flow", "Operating Cash Flow"),
        "capital_expenditure": _latest(cashflow_df, "capital_expenditure", "Capital Expenditure"),
        "free_cash_flow":    _latest(cashflow_df, "free_cash_flow", "Free Cash Flow"),
        "depreciation_amortization": _latest(cashflow_df, "depreciation_and_amortization", "Reconciled Depreciation"),
    }
