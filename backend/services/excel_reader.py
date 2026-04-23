"""Reads raw_data.xlsx sheets and serves them as Python dicts.

Caches parsed DataFrames in memory, invalidates when file mtime changes.
Lazy-loads each sheet on first access.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from config import RAW_DATA_PATH


@dataclass(frozen=True)
class SheetData:
    name: str
    columns: tuple[str, ...]
    data: tuple[dict[str, Any], ...]
    has_index: bool
    index_name: str | None


class ExcelReader:
    """Reads raw_data.xlsx once, caches in memory, reloads on file change."""

    def __init__(self, file_path: Path = RAW_DATA_PATH) -> None:
        self._file_path = file_path
        self._cache: dict[str, SheetData] = {}
        self._df_cache: dict[str, pd.DataFrame] = {}
        self._sheet_names: list[str] | None = None
        self._last_mtime: float = 0.0

    def _maybe_invalidate(self) -> None:
        if not self._file_path.exists():
            self._cache.clear()
            self._df_cache.clear()
            self._sheet_names = None
            return
        current_mtime = os.path.getmtime(self._file_path)
        if current_mtime != self._last_mtime:
            self._cache.clear()
            self._df_cache.clear()
            self._sheet_names = None
            self._last_mtime = current_mtime

    def get_sheet_names(self) -> list[str]:
        self._maybe_invalidate()
        if self._sheet_names is None:
            if not self._file_path.exists():
                return []
            xls = pd.ExcelFile(self._file_path, engine="openpyxl")
            self._sheet_names = xls.sheet_names
            xls.close()
        return list(self._sheet_names)

    def get_sheet(self, name: str) -> SheetData | None:
        self._maybe_invalidate()
        if name in self._cache:
            return self._cache[name]

        if not self._file_path.exists():
            return None

        available = self.get_sheet_names()
        if name not in available:
            return None

        df = pd.read_excel(self._file_path, sheet_name=name, engine="openpyxl")

        has_index = False
        index_name: str | None = None

        # Detect if the first column looks like a date index
        if len(df.columns) > 0:
            first_col = df.columns[0]
            if isinstance(first_col, str) and ("date" in first_col.lower() or "period" in first_col.lower()):
                has_index = True
                index_name = first_col

        # Convert timestamps to ISO strings for JSON serialization
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime("%Y-%m-%d")

        # Handle index if it's a DatetimeIndex
        if isinstance(df.index, pd.DatetimeIndex):
            df.index = df.index.strftime("%Y-%m-%d")
            has_index = True
            index_name = df.index.name

        # Replace NaN with None for clean JSON
        df = df.where(pd.notna(df), None)

        columns = tuple(str(c) for c in df.columns)
        data = tuple(df.to_dict(orient="records"))

        sheet_data = SheetData(
            name=name,
            columns=columns,
            data=data,
            has_index=has_index,
            index_name=index_name,
        )
        self._cache[name] = sheet_data
        return sheet_data

    def get_sheet_as_df(self, name: str) -> pd.DataFrame | None:
        """Get a raw DataFrame, cached in memory until file mtime changes."""
        self._maybe_invalidate()
        if name in self._df_cache:
            return self._df_cache[name].copy()
        if not self._file_path.exists():
            return None
        available = self.get_sheet_names()
        if name not in available:
            return None
        df = pd.read_excel(self._file_path, sheet_name=name, engine="openpyxl")
        self._df_cache[name] = df
        return df.copy()


# Singleton instance
reader = ExcelReader()
