"""API response envelope models."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SheetListResponse(BaseModel):
    sheets: list[str]
    sheet_count: int


class SheetDataResponse(BaseModel):
    sheet_name: str
    columns: list[str]
    data: list[dict[str, Any]]
    row_count: int
    has_index: bool
    index_name: str | None = None


class FinancialSummaryResponse(BaseModel):
    ticker: str
    data: dict[str, Any]


class AnalyzeRequest(BaseModel):
    # API key intentionally omitted from the body — clients send it in an
    # `Authorization: Bearer <key>` header instead so it never lands in
    # request-body logs or 422 validation echoes. The legacy `api_key`
    # field is accepted for backward compatibility with any older client
    # that has not been updated yet, but new clients MUST use the header.
    api_key: str | None = None
    provider: str = "anthropic"  # "anthropic" | "perplexity" | "gemini"
    deep_research: bool = False


class PipelineRequest(BaseModel):
    fred_api_key: str | None = None


class AgentStepEvent(BaseModel):
    type: str  # "step" | "result" | "error"
    message: str = ""
    data: dict[str, Any] | None = None


class HealthResponse(BaseModel):
    status: str
    raw_data_exists: bool
    configured_providers: list[str] = []
    configured_provider_count: int = 0
