"""Pydantic models for the financial summary payload."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CompetitorSnapshot(BaseModel):
    ticker: str
    company_name: str = ""
    market_cap: float | None = None
    pe: float | None = None
    enterprise_value: float | None = None
    sales_ttm: float | None = None
    ebitda_ttm: float | None = None
    stockholders_equity: float | None = None


class FinancialSummary(BaseModel):
    ticker: str
    company_name: str = ""
    sector: str = ""
    industry: str = ""
    business_summary: str = ""
    current_price: float | None = None
    shares_outstanding: float | None = None

    # Valuation metrics
    market_cap: float | None = None
    enterprise_value: float | None = None
    pe_ratio_ttm: float | None = None
    forward_pe: float | None = None
    pb_ratio: float | None = None
    ev_to_ebitda: float | None = None
    ev_to_revenue: float | None = None
    profit_margin: float | None = None
    operating_margin: float | None = None
    roe: float | None = None
    roa: float | None = None
    debt_to_equity: float | None = None
    current_ratio: float | None = None
    beta: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None

    # Revenue/EBITDA history
    revenue_history: list[dict[str, Any]] = []
    ebitda_history: list[dict[str, Any]] = []
    revenue_latest: float | None = None
    operating_income: float | None = None

    # Balance sheet
    total_debt: float | None = None
    total_cash: float | None = None
    total_equity: float | None = None

    # Cash flow
    operating_cash_flow: float | None = None
    capex: float | None = None
    free_cash_flow: float | None = None

    # DDM
    dividend_yield: float | None = None
    annual_dividend_rate: float | None = None
    payout_ratio: float | None = None
    dividend_growth_5yr: float | None = None
    dividend_growth_3yr: float | None = None
    years_of_dividend_history: float | None = None
    payment_frequency: str = "N/A"

    # Beta
    regression_beta: float | None = None
    beta_r_squared: float | None = None
    beta_std_error: float | None = None

    # FRED
    risk_free_rate_10yr: float | None = None
    risk_free_rate_5yr: float | None = None
    fed_funds_rate: float | None = None
    cpi: float | None = None
    vix: float | None = None
    real_gdp_growth: float | None = None

    # Competitors
    competitors: list[CompetitorSnapshot] = []

    # Analyst estimates
    analyst_target_mean: float | None = None
    analyst_target_low: float | None = None
    analyst_target_high: float | None = None

    # Price history and return metrics
    stock_price_history: list[dict[str, Any]] = []
    period_returns: dict[str, Any] | None = None
    risk_metrics: dict[str, Any] | None = None
