"""Pydantic models for the CFA critique and refinement endpoints."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class CritiqueIssue(BaseModel):
    check: str
    severity: Literal["critical", "warning", "info"]
    category: str
    message: str
    detail: str
    suggestion: str


class CritiqueCategory(BaseModel):
    name: str
    icon: str
    grade: Literal["pass", "warn", "fail"]
    issues: list[CritiqueIssue] = []


class CritiqueReport(BaseModel):
    ticker: str
    overall_grade: Literal["A", "B", "C", "D", "F"]
    overall_score: int  # 0-100
    categories: list[CritiqueCategory]
    issues: list[CritiqueIssue]
    summary: str
    auto_refinable: bool  # True if AI can auto-fix some issues


class CritiqueRequest(BaseModel):
    ticker: str
    assumptions: dict[str, Any]
    dcf_output: dict[str, Any] | None = None
    ddm_output: dict[str, Any] | None = None
    comps_output: dict[str, Any] | None = None
    scenario_output: dict[str, Any] | None = None
    financial_data: dict[str, Any] | None = None


class RefineRequest(BaseModel):
    ticker: str
    assumptions: dict[str, Any]
    issues: list[dict[str, Any]]
    financial_data: dict[str, Any] | None = None
    api_key: str | None = None
    provider: str = "anthropic"


class RefineResponse(BaseModel):
    revised_assumptions: dict[str, Any]
    changes_made: list[str]
    rationale: str
