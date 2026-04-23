"""Sheet data endpoints — list and retrieve raw_data.xlsx sheets as JSON."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException

from services.excel_reader import reader

router = APIRouter(tags=["sheets"])

VALID_SHEET_NAME = re.compile(r"^[\w\s\-().]+$")


@router.get("/sheets")
async def list_sheets() -> dict[str, object]:
    names = reader.get_sheet_names()
    if not names:
        raise HTTPException(
            status_code=404,
            detail="raw_data.xlsx not found. Run 'py main.py' first.",
        )
    return {
        "sheets": names,
        "sheet_count": len(names),
    }


@router.get("/sheets/{sheet_name}")
async def get_sheet(sheet_name: str) -> dict[str, object]:
    # Basic input validation
    if not VALID_SHEET_NAME.match(sheet_name):
        raise HTTPException(status_code=400, detail="Invalid sheet name")

    sheet_data = reader.get_sheet(sheet_name)
    if sheet_data is None:
        available = reader.get_sheet_names()
        raise HTTPException(
            status_code=404,
            detail=f"Sheet '{sheet_name}' not found. Available: {available[:10]}",
        )
    return {
        "sheet_name": sheet_data.name,
        "columns": list(sheet_data.columns),
        "data": list(sheet_data.data),
        "row_count": len(sheet_data.data),
        "has_index": sheet_data.has_index,
        "index_name": sheet_data.index_name,
    }
