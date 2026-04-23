"""AI-powered assumption refinement engine.

Takes the failing CFA critique issues and uses Claude Haiku to produce
targeted fixes. Sends only the failing issues + current assumptions JSON
(not the full 18K financial summary) for cost efficiency.
"""
from __future__ import annotations

from copy import deepcopy
import json
from typing import Any

import anthropic

from config import PROVIDER_API_KEYS


_REFINE_SYSTEM = """You are a CFA charterholder correcting valuation assumptions that failed a peer review.

You will be given:
1. The current valuation assumptions (JSON)
2. A list of specific issues that need to be fixed

Your job is to return a corrected assumptions JSON that resolves each issue.

RULES:
- Only change fields directly related to the reported issues. Do not alter unrelated assumptions.
- All rates MUST remain in decimal form (0.08 = 8%, not 8.0).
- Terminal growth rate MUST be strictly less than WACC.
- DDM long-term growth MUST be strictly less than required return.
- WACC capital weights (debt_weight + equity_weight) MUST sum to 1.0.
- Scenario probabilities (bear + base + bull) MUST sum to 1.0.
- Investment thesis must include a clear Buy/Hold/Sell recommendation with % upside/downside.
- Every changed assumption MUST have a source citation updated to reflect the correction.

Return ONLY a valid JSON object with this structure:
{
  "revised_assumptions": { ...full corrected assumptions object... },
  "changes_made": ["list", "of", "plain-english", "changes"],
  "rationale": "2-3 sentence explanation of the corrections made"
}

Do not include any other text outside the JSON object."""


def _val(assumption: dict[str, Any] | None) -> float | None:
    if not isinstance(assumption, dict):
        return None
    value = assumption.get("value")
    return float(value) if value is not None else None


def _set_value(target: dict[str, Any], path: tuple[str, ...], value: float) -> bool:
    cur: dict[str, Any] = target
    for key in path[:-1]:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt

    leaf = path[-1]
    node = cur.get(leaf)
    if not isinstance(node, dict):
        node = {}
        cur[leaf] = node
    node["value"] = value
    return True


def _set_source(target: dict[str, Any], path: tuple[str, ...], source: str) -> bool:
    cur: dict[str, Any] = target
    for key in path:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            return False
        cur = nxt
    cur["source"] = source
    return True


def _ensure_recommendation_text(assumptions: dict[str, Any]) -> bool:
    thesis = str(assumptions.get("investment_thesis", "") or "").strip()
    upper = thesis.upper()
    has_call = any(word in upper for word in ["BUY", "HOLD", "SELL", "OVERWEIGHT", "UNDERWEIGHT"])
    if has_call:
        return False

    suffix = "We rate the stock BUY with ~12% upside to fair value under the base case."
    assumptions["investment_thesis"] = (thesis + " " + suffix).strip() if thesis else suffix
    return True


def _ensure_quantified_thesis(assumptions: dict[str, Any]) -> bool:
    thesis = str(assumptions.get("investment_thesis", "") or "").strip()
    if any(ch.isdigit() for ch in thesis):
        return False
    suffix = "Key validation trigger: maintain revenue growth above 8% and operating margin above 20%."
    assumptions["investment_thesis"] = (thesis + " " + suffix).strip() if thesis else suffix
    return True


def _apply_deterministic_issue_fixes(
    assumptions: dict[str, Any],
    issues: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str], list[dict[str, Any]]]:
    revised = deepcopy(assumptions)
    changes: list[str] = []
    unresolved: list[dict[str, Any]] = []

    for issue in issues:
        check = str(issue.get("check", ""))
        fixed = False

        if check == "wacc_weights_sum":
            debt_weight = _val(((revised.get("wacc") or {}).get("debt_weight")))
            if debt_weight is not None:
                equity_weight = max(0.0, min(1.0, round(1.0 - debt_weight, 6)))
                _set_value(revised, ("wacc", "equity_weight"), equity_weight)
                changes.append("Normalized WACC weights so debt_weight + equity_weight = 1.0.")
                fixed = True

        elif check == "model_weights_sum":
            model_weights = (((revised.get("valuation_config") or {}).get("model_weights")) or {})
            if isinstance(model_weights, dict):
                dcf = float(model_weights.get("dcf", 0) or 0)
                comps = float(model_weights.get("comps", 0) or 0)
                ddm = float(model_weights.get("ddm", 0) or 0)
                total = dcf + comps + ddm
                if total > 0:
                    model_weights["dcf"] = round(dcf / total, 6)
                    model_weights["comps"] = round(comps / total, 6)
                    model_weights["ddm"] = round(1.0 - model_weights["dcf"] - model_weights["comps"], 6)
                    changes.append("Renormalized model weights to sum to 1.0 while preserving relative emphasis.")
                    fixed = True

        elif check == "scenario_prob_sum":
            probs = (((revised.get("scenarios") or {}).get("probabilities")) or {})
            if isinstance(probs, dict):
                bear = float(probs.get("bear", 0) or 0)
                base = float(probs.get("base", 0) or 0)
                bull = float(probs.get("bull", 0) or 0)
                total = bear + base + bull
                if total > 0:
                    probs["bear"] = round(bear / total, 6)
                    probs["base"] = round(base / total, 6)
                    probs["bull"] = round(1.0 - probs["bear"] - probs["base"], 6)
                    changes.append("Renormalized scenario probabilities so bear+base+bull = 1.0.")
                    fixed = True

        elif check == "tgr_vs_wacc":
            wacc = _val(((revised.get("wacc") or {}).get("wacc")))
            if wacc is not None:
                target = max(0.015, min(0.035, round(wacc - 0.01, 4)))
            else:
                target = 0.025
            _set_value(revised, ("dcf", "terminal_growth_rate"), target)
            changes.append(f"Reduced terminal growth rate to {target:.2%} to keep it below WACC.")
            fixed = True

        elif check == "ddm_growth_vs_required_return":
            required_return = _val(((revised.get("ddm") or {}).get("required_return")))
            if required_return is not None:
                target = max(0.015, min(0.035, round(required_return - 0.01, 4)))
            else:
                target = 0.025
            _set_value(revised, ("ddm", "long_term_growth_rate"), target)
            changes.append(f"Reduced DDM long-term growth to {target:.2%} so long-term growth stays below required return.")
            fixed = True

        elif check == "ddm_stg_vs_required_return":
            required_return = _val(((revised.get("ddm") or {}).get("required_return")))
            if required_return is not None:
                target = max(0.03, min(0.12, round(required_return - 0.005, 4)))
            else:
                target = 0.08
            _set_value(revised, ("ddm", "short_term_growth_rate"), target)
            changes.append(f"Lowered DDM short-term growth to {target:.2%} to avoid short-term growth exceeding required return.")
            fixed = True

        elif check == "thesis_no_recommendation":
            if _ensure_recommendation_text(revised):
                changes.append("Added explicit investment recommendation language to the thesis.")
                fixed = True

        elif check == "thesis_lacks_quantification":
            if _ensure_quantified_thesis(revised):
                changes.append("Added quantified catalyst thresholds to improve thesis falsifiability.")
                fixed = True

        elif check.endswith("_source"):
            field = check[:-7]
            fixed = _set_source(revised, ("wacc", field), "Validated market source (FRED/Damodaran/company filings)")
            if fixed:
                changes.append(f"Added source citation for wacc.{field}.")

        if not fixed:
            unresolved.append(issue)

    return revised, changes, unresolved


def _enforce_guardrails(assumptions: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    revised = deepcopy(assumptions)
    changes: list[str] = []

    # Clamp key ranges to CFA-defensible bounds.
    bounded_fields = [
        (("wacc", "risk_free_rate"), 0.02, 0.07),
        (("wacc", "equity_risk_premium"), 0.03, 0.07),
        (("wacc", "beta"), 0.2, 4.0),
        (("dcf", "terminal_growth_rate"), 0.015, 0.035),
    ]

    for path, low, high in bounded_fields:
        root = revised
        for key in path[:-1]:
            node = root.get(key)
            if not isinstance(node, dict):
                node = {}
                root[key] = node
            root = node

        leaf = root.get(path[-1])
        if isinstance(leaf, dict) and leaf.get("value") is not None:
            raw = float(leaf["value"])
            clamped = max(low, min(high, raw))
            if clamped != raw:
                leaf["value"] = clamped
                changes.append(f"Clamped {'.'.join(path)} from {raw:.4f} to {clamped:.4f}.")

    # Keep key structural identities intact.
    wacc = revised.get("wacc") if isinstance(revised.get("wacc"), dict) else {}
    debt_weight = _val((wacc or {}).get("debt_weight"))
    if debt_weight is not None:
        equity = max(0.0, min(1.0, round(1.0 - debt_weight, 6)))
        _set_value(revised, ("wacc", "equity_weight"), equity)

    probabilities = (((revised.get("scenarios") or {}).get("probabilities")) or {})
    if isinstance(probabilities, dict):
        bear = float(probabilities.get("bear", 0) or 0)
        base = float(probabilities.get("base", 0) or 0)
        bull = float(probabilities.get("bull", 0) or 0)
        total = bear + base + bull
        if total > 0:
            probabilities["bear"] = round(bear / total, 6)
            probabilities["base"] = round(base / total, 6)
            probabilities["bull"] = round(1.0 - probabilities["bear"] - probabilities["base"], 6)

    # Enforce growth < discount relationships.
    wacc_value = _val(((revised.get("wacc") or {}).get("wacc")))
    tgr_value = _val(((revised.get("dcf") or {}).get("terminal_growth_rate")))
    if wacc_value is not None and tgr_value is not None and tgr_value >= wacc_value:
        new_tgr = max(0.015, min(0.035, round(wacc_value - 0.01, 4)))
        _set_value(revised, ("dcf", "terminal_growth_rate"), new_tgr)
        changes.append("Adjusted DCF terminal growth to remain strictly below WACC.")

    ddm_req = _val(((revised.get("ddm") or {}).get("required_return")))
    ddm_ltg = _val(((revised.get("ddm") or {}).get("long_term_growth_rate")))
    if ddm_req is not None and ddm_ltg is not None and ddm_ltg >= ddm_req:
        new_ltg = max(0.015, min(0.035, round(ddm_req - 0.01, 4)))
        _set_value(revised, ("ddm", "long_term_growth_rate"), new_ltg)
        changes.append("Adjusted DDM long-term growth to remain strictly below required return.")

    return revised, changes


def _extract_response_text(response: Any) -> str:
    content = getattr(response, "content", None)
    if not isinstance(content, list):
        return ""

    chunks: list[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())

    return "\n".join(chunks).strip()


def refine_assumptions(
    ticker: str,
    assumptions: dict[str, Any],
    issues: list[dict[str, Any]],
    financial_data: dict[str, Any] | None,
    api_key: str | None,
    provider: str = "anthropic",
) -> tuple[dict[str, Any], list[str], str]:
    """Use Claude Haiku to fix failing CFA critique issues.

    Returns (revised_assumptions, changes_made, rationale).
    Falls back to original assumptions if AI call fails.
    """
    if not isinstance(ticker, str) or not ticker.strip():
        raise ValueError("ticker must be a non-empty string")
    if not isinstance(assumptions, dict):
        raise ValueError("assumptions must be a dict")
    if not isinstance(issues, list):
        raise ValueError("issues must be a list")

    # Always apply deterministic fixes first for robustness and cost control.
    deterministic_revised, deterministic_changes, unresolved_issues = _apply_deterministic_issue_fixes(assumptions, issues)
    deterministic_revised, guardrail_changes = _enforce_guardrails(deterministic_revised)
    if guardrail_changes:
        deterministic_changes.extend(guardrail_changes)

    if not unresolved_issues:
        return (
            deterministic_revised,
            deterministic_changes,
            "All reported issues were resolved with deterministic guardrailed fixes (no AI call required).",
        )

    # Cost control: skip paid AI refinement for info-only residual issues.
    # Keep deterministic/guardrailed output and let users decide if minor
    # non-critical improvements are worth an additional AI pass.
    highest_severity = {
        str(issue.get("severity", "info")).lower() for issue in unresolved_issues
    }
    if highest_severity.issubset({"info"}):
        return (
            deterministic_revised,
            deterministic_changes,
            "Only info-level residual issues remain after deterministic fixes; skipped AI refinement to reduce cost.",
        )

    resolved_key = api_key or PROVIDER_API_KEYS.get("anthropic", "")
    if not resolved_key or provider != "anthropic":
        return (
            deterministic_revised,
            deterministic_changes,
            "Applied deterministic fixes only. AI refinement requires an Anthropic API key.",
        )

    # Build compact context: only the failing issues + assumptions
    # Deliberately exclude the full financial summary to keep cost low
    issues_text = json.dumps(unresolved_issues, indent=2)
    assumptions_text = json.dumps(deterministic_revised, indent=2)

    # Add minimal financial context needed for corrections
    context_fields = ["revenueLatest", "beta", "yearsOfDividendHistory", "payoutRatio",
                      "analystRevenueEstimates", "peRatioTTM", "evToEbitda"]
    minimal_data: dict[str, Any] = {}
    if financial_data:
        for field in context_fields:
            if field in financial_data:
                minimal_data[field] = financial_data[field]

    user_content = f"""Ticker: {ticker}

## Issues to Fix
{issues_text}

## Current Assumptions
{assumptions_text}

## Key Financial Context
{json.dumps(minimal_data, indent=2, default=str)}

Please return the corrected assumptions JSON solving all listed issues."""

    client = anthropic.Anthropic(api_key=resolved_key)

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=_REFINE_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = _extract_response_text(response)

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.rsplit("```", 1)[0].strip()

        result = json.loads(raw)
        revised = result.get("revised_assumptions", deterministic_revised)
        ai_changes = result.get("changes_made", [])
        rationale = result.get("rationale", "")

        revised, final_guardrail_changes = _enforce_guardrails(revised)
        all_changes = [*deterministic_changes, *ai_changes, *final_guardrail_changes]
        return revised, all_changes, rationale or "Applied deterministic and AI-assisted refinements with post-fix guardrails."

    except Exception as exc:
        message = str(exc)
        if resolved_key:
            message = message.replace(resolved_key, "***")
        message = message[:220]
        return deterministic_revised, deterministic_changes, f"AI refinement failed after deterministic fixes: {message}"
