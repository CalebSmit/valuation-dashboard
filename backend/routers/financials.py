"""Financial summary and forecast preset endpoints."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from services.excel_reader import reader
from services.financial_summarizer import extract_financial_summary

router = APIRouter(tags=["financials"])


@router.get("/financials/summary")
async def get_financial_summary() -> dict[str, object]:
    if not reader.get_sheet_names():
        raise HTTPException(
            status_code=404,
            detail="raw_data.xlsx not found. Run 'py main.py' first.",
        )

    summary = extract_financial_summary(reader)
    return {
        "ticker": summary.get("ticker", "UNKNOWN"),
        "data": summary,
    }


@router.get("/forecasts/presets")
async def get_forecast_presets() -> dict[str, Any]:
    """Return Python-computed preset assumptions and base year actuals from historical data."""
    if not reader.get_sheet_names():
        raise HTTPException(
            status_code=404,
            detail="raw_data.xlsx not found. Run 'py main.py' first.",
        )

    # Add project root to sys.path so we can import add_forecast_statements
    from config import PROJECT_DIR
    if str(PROJECT_DIR) not in sys.path:
        sys.path.insert(0, str(PROJECT_DIR))

    try:
        from add_forecast_statements import compute_preset_assumptions, extract_base_year

        income_df = reader.get_sheet_as_df("Raw_Income_Statement")
        balance_df = reader.get_sheet_as_df("Raw_Balance_Sheet")
        cashflow_df = reader.get_sheet_as_df("Raw_Cash_Flow")

        if income_df is None or balance_df is None or cashflow_df is None:
            raise HTTPException(status_code=404, detail="Financial statements not found in raw_data.xlsx")

        if income_df.empty or balance_df.empty or cashflow_df.empty:
            raise HTTPException(status_code=400, detail="Financial statements are empty")

        presets = compute_preset_assumptions(income_df, balance_df, cashflow_df)
        base_year = extract_base_year(income_df, balance_df, cashflow_df)

        return {"presets": presets, "base_year": base_year}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute forecast presets: {str(e)}")
