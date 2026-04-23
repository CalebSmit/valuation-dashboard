"""CFA critique and AI refinement endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from config import PROVIDER_API_KEYS
from models.critique import CritiqueRequest, CritiqueReport, RefineRequest, RefineResponse
from services.critique_engine import run_critique
from services.refine_engine import refine_assumptions

router = APIRouter(tags=["critique"])


@router.post("/critique", response_model=CritiqueReport)
async def critique_valuation(req: CritiqueRequest) -> CritiqueReport:
    """Run deterministic CFA critique checks against a completed valuation run.

    Fast — no AI calls. Returns structured issues with severity levels and
    an overall grade (A–F). Safe to call after every run automatically.
    """
    return run_critique(
        ticker=req.ticker,
        assumptions=req.assumptions,
        dcf_output=req.dcf_output,
        ddm_output=req.ddm_output,
        comps_output=req.comps_output,
        scenario_output=req.scenario_output,
        financial_data=req.financial_data,
    )


@router.post("/refine", response_model=RefineResponse)
async def refine_valuation(req: RefineRequest) -> RefineResponse:
    """Use Claude Haiku to auto-fix assumptions that failed CFA critique checks.

    Sends only the failing issues + assumptions (not the full 18K financial
    summary) so cost is minimal (~$0.001-0.003 per refinement call).
    """
    api_key = req.api_key or PROVIDER_API_KEYS.get("anthropic", "")
    revised, changes, rationale = refine_assumptions(
        ticker=req.ticker,
        assumptions=req.assumptions,
        issues=req.issues,
        financial_data=req.financial_data,
        api_key=api_key,
        provider=req.provider,
    )
    return RefineResponse(
        revised_assumptions=revised,
        changes_made=changes,
        rationale=rationale,
    )
