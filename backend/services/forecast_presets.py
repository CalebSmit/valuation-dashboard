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


def _days_metric(numerator: pd.Series | None, denominator: pd.Series | None, scale: float = 365.0, n: int = 3) -> float | None:
    """Compute average days metric (e.g. DSO = AR / Revenue * 365)."""
    if numerator is None or denominator is None:
        return None
    num = numerator.head(n).apply(_safe).dropna()
    den = denominator.head(n).apply(_safe).dropna()
    combined = pd.concat([num, den], axis=1).dropna()
    combined.columns = ["num", "den"]
    combined = combined[combined["den"].abs() > 0]
    if combined.empty:
        return None
    ratios = (combined["num"] / combined["den"]) * scale
    result = float(ratios.mean())
    # Sanity-clamp: days metrics shouldn't be negative or absurdly large
    return max(0.0, min(result, 365.0))


def compute_preset_assumptions(
    income_df: pd.DataFrame,
    balance_df: pd.DataFrame,
    cashflow_df: pd.DataFrame,
) -> dict[str, Any]:
    """Derive preset assumptions from historical financial statements.

    Returns a dict matching the shape expected by the AI agent and the
    ForecastsTab component: all fields in PresetAssumptions must be present
    (with sensible fallbacks) so .toFixed() calls never crash.
    """
    revenue  = _col(income_df,   "total_revenue",   "Total Revenue",  "Revenue")
    cogs     = _col(income_df,   "cost_of_revenue",  "Cost Of Revenue", "Cost of Goods Sold", "COGS")
    rnd      = _col(income_df,   "research_development", "Research And Development", "R&D Expense")
    sga      = _col(income_df,   "selling_general_administrative", "Selling General And Administration",
                    "Selling General Administrative", "SGA")
    ebitda   = _col(income_df,   "ebitda",   "EBITDA",  "Normalized EBITDA")
    ebit     = _col(income_df,   "ebit",     "EBIT",    "Operating Income", "operating_income")
    int_exp  = _col(income_df,   "interest_expense", "Interest Expense")
    total_debt_col = _col(balance_df, "total_debt", "Total Debt")
    ppe      = _col(balance_df,  "net_ppe", "Net PPE", "property_plant_equipment_net",
                    "Net Property Plant And Equipment")
    ar       = _col(balance_df,  "accounts_receivable", "Accounts Receivable",
                    "net_receivables", "Net Receivables")
    inv      = _col(balance_df,  "inventory", "Inventory", "Inventories")
    ap       = _col(balance_df,  "accounts_payable", "Accounts Payable")
    capex    = _col(cashflow_df, "capital_expenditure", "Capital Expenditure", "CapEx")
    dep_am   = _col(cashflow_df, "depreciation_and_amortization", "Reconciled Depreciation",
                    "Depreciation Amortization Depletion")
    nwc_chg  = _col(cashflow_df, "change_in_working_capital", "Changes In Working Capital",
                    "Working Capital Changes")
    sbc_col  = _col(cashflow_df, "stock_based_compensation", "Stock Based Compensation",
                    "Share Based Compensation Expense")
    divs     = _col(cashflow_df, "common_stock_dividend_paid", "Cash Dividends Paid",
                    "Payment Of Dividends", "dividends_paid")
    net_inc  = _col(income_df,   "net_income", "Net Income")

    # Cost of debt: interest expense / average total debt
    cost_of_debt: float | None = None
    if int_exp is not None and total_debt_col is not None:
        ie = int_exp.head(3).apply(_safe).dropna()
        td = total_debt_col.head(3).apply(_safe).dropna()
        combined = pd.concat([ie.abs(), td], axis=1).dropna()
        combined.columns = ["ie", "td"]
        combined = combined[combined["td"].abs() > 1e6]  # ignore near-zero debt
        if not combined.empty:
            ratios = combined["ie"] / combined["td"]
            val = float(ratios.mean())
            cost_of_debt = max(0.01, min(val, 0.20))  # clamp to sane range

    # Dividend payout ratio: dividends paid / net income
    div_payout: float | None = None
    if divs is not None and net_inc is not None:
        d = divs.head(3).apply(_safe).dropna().abs()
        n = net_inc.head(3).apply(_safe).dropna()
        combined = pd.concat([d, n], axis=1).dropna()
        combined.columns = ["d", "n"]
        combined = combined[combined["n"] > 0]
        if not combined.empty:
            ratios = combined["d"] / combined["n"]
            val = float(ratios.mean())
            div_payout = max(0.0, min(val, 1.0))

    # D&A % of PP&E (net)
    da_pct_ppe: float | None = None
    if dep_am is not None and ppe is not None:
        da_series = dep_am.head(3).apply(_safe).dropna().abs()
        ppe_series = ppe.head(3).apply(_safe).dropna()
        combined = pd.concat([da_series, ppe_series], axis=1).dropna()
        combined.columns = ["da", "ppe"]
        combined = combined[combined["ppe"].abs() > 1e6]
        if not combined.empty:
            ratios = combined["da"] / combined["ppe"]
            val = float(ratios.mean())
            da_pct_ppe = max(0.0, min(val, 0.50))

    presets: dict[str, Any] = {
        "cogs_pct_revenue":    _avg_ratio(cogs,    revenue),
        "rnd_pct_revenue":     _avg_ratio(rnd,     revenue),
        "sga_pct_revenue":     _avg_ratio(sga,     revenue),
        "ebitda_pct_revenue":  _avg_ratio(ebitda,  revenue),
        "ebit_pct_revenue":    _avg_ratio(ebit,    revenue),
        "capex_pct_revenue":   _avg_ratio(capex,   revenue),
        "da_pct_revenue":      _avg_ratio(dep_am,  revenue),
        "nwc_chg_pct_revenue": _avg_ratio(nwc_chg, revenue),
        # Working capital days
        "dso_days":            _days_metric(ar,  revenue),
        "dio_days":            _days_metric(inv, cogs if cogs is not None else revenue),
        "dpo_days":            _days_metric(ap,  cogs if cogs is not None else revenue),
        # Additional fields required by ForecastsTab
        "da_pct_ppe":          da_pct_ppe,
        "sbc_pct_revenue":     _avg_ratio(sbc_col, revenue),
        "dividend_payout_ratio": div_payout,
        "cost_of_debt":        cost_of_debt,
        "effective_tax_rate":  None,   # derived from income statement below
    }

    # Revenue CAGR (most recent 3 years)
    if revenue is not None and len(revenue.dropna()) >= 2:
        rev_vals = revenue.dropna().apply(_safe).dropna()
        rev_vals = rev_vals[rev_vals > 0]
        if len(rev_vals) >= 2:
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

    # Effective tax rate: tax provision / pretax income
    tax_prov  = _col(income_df, "tax_provision", "Income Tax Expense", "Tax Provision")
    pretax    = _col(income_df, "pretax_income",  "Pretax Income", "Income Before Tax")
    if tax_prov is not None and pretax is not None:
        tp = tax_prov.head(3).apply(_safe).dropna().abs()
        pt = pretax.head(3).apply(_safe).dropna()
        combined = pd.concat([tp, pt], axis=1).dropna()
        combined.columns = ["tp", "pt"]
        combined = combined[combined["pt"] > 0]
        if not combined.empty:
            ratios = combined["tp"] / combined["pt"]
            val = float(ratios.mean())
            presets["effective_tax_rate"] = max(0.0, min(val, 0.50))

    # Fill any still-None required fields with reasonable industry defaults
    # so the UI never receives undefined for a field it calls .toFixed() on.
    _defaults: dict[str, float] = {
        "dso_days": 45.0,
        "dio_days": 30.0,
        "dpo_days": 30.0,
        "da_pct_ppe": 0.10,
        "sbc_pct_revenue": 0.02,
        "dividend_payout_ratio": 0.0,
        "cost_of_debt": 0.05,
        "effective_tax_rate": 0.21,
        "capex_pct_revenue": 0.05,
        "cogs_pct_revenue": 0.60,
        "sga_pct_revenue": 0.10,
        "rnd_pct_revenue": 0.0,
    }
    for key, default in _defaults.items():
        if presets.get(key) is None:
            presets[key] = default

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
