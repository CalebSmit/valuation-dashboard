"""Deterministic CFA-grade critique engine.

Runs pure math/logic checks against a completed valuation run.
No AI calls — fast, reproducible, transparent.

Checks modelled on CFA Institute Research Challenge judging criteria.
"""
from __future__ import annotations

from typing import Any

from models.critique import CritiqueCategory, CritiqueIssue, CritiqueReport


_WEAK_SOURCE_MARKERS = {"", "n/a", "na", "unknown", "estimate", "estimated", "internal", "manual"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _f(d: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Safe nested dict access."""
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k, default)
    return cur


def _val(assumption: dict[str, Any] | None) -> float | None:
    if not isinstance(assumption, dict):
        return None
    v = assumption.get("value")
    return float(v) if v is not None else None


def _src(assumption: dict[str, Any] | None) -> str:
    if not isinstance(assumption, dict):
        return ""
    return str(assumption.get("source", "")).strip()


def _has_numeric_text(text: str) -> bool:
    return any(ch.isdigit() for ch in text)


def _issue(
    check: str,
    severity: str,
    category: str,
    message: str,
    detail: str,
    suggestion: str,
) -> CritiqueIssue:
    return CritiqueIssue(
        check=check,
        severity=severity,  # type: ignore[arg-type]
        category=category,
        message=message,
        detail=detail,
        suggestion=suggestion,
    )


# ── individual check groups ───────────────────────────────────────────────────

def _check_wacc(assumptions: dict[str, Any], dcf_output: dict[str, Any] | None) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    wacc = assumptions.get("wacc", {})

    wacc_val = _val(wacc.get("risk_free_rate"))
    erp_val = _val(wacc.get("equity_risk_premium"))
    beta_val = _val(wacc.get("beta"))
    size_prem = _val(wacc.get("size_premium"))
    cod = _val(wacc.get("cost_of_debt"))
    dw = _val(wacc.get("debt_weight"))
    ew = _val(wacc.get("equity_weight"))
    tax = _val(wacc.get("tax_rate"))

    # Capital weights sum check
    if dw is not None and ew is not None:
        total = round(dw + ew, 4)
        if abs(total - 1.0) > 0.02:
            issues.append(_issue(
                "wacc_weights_sum",
                "critical",
                "WACC",
                f"Capital weights don't sum to 1.0 (got {total:.3f})",
                f"Debt weight {dw:.2%} + equity weight {ew:.2%} = {total:.3f}",
                "Set equity_weight = 1 - debt_weight (use market value weights per CFA standard).",
            ))

    # WACC absolute range — compute implied
    computed_wacc = dcf_output.get("wacc") if dcf_output else None
    if computed_wacc is not None:
        if not (0.06 <= computed_wacc <= 0.14):
            issues.append(_issue(
                "wacc_range",
                "critical",
                "WACC",
                f"WACC of {computed_wacc:.2%} is outside the 6–14% defensible range",
                "CFA Institute guidelines require WACC in 6–14% for developed-market equities.",
                "Re-examine beta, ERP, and size premium. A WACC below 6% may use an overly low beta.",
            ))

    # Risk-free rate sanity (should be roughly 3-6% for current environment)
    if wacc_val is not None:
        if not (0.02 <= wacc_val <= 0.07):
            issues.append(_issue(
                "rfr_range",
                "warning",
                "WACC",
                f"Risk-free rate {wacc_val:.2%} is outside the typical 2–7% range",
                "Should match the 10-yr Treasury yield from FRED.",
                "Confirm the FRED 10Y treasury yield was used as-is, not divided by 100.",
            ))

    # ERP sanity
    if erp_val is not None:
        if not (0.03 <= erp_val <= 0.07):
            issues.append(_issue(
                "erp_range",
                "warning",
                "WACC",
                f"Equity risk premium {erp_val:.2%} is outside the typical 3–7% range (Damodaran: ~4.2-4.6% in 2025)",
                f"ERP used: {erp_val:.4f}",
                "Use Damodaran's current implied ERP (~4.2-4.6% for Jan 2025). Cite the source.",
            ))

    # Beta sanity
    if beta_val is not None:
        if not (0.2 <= beta_val <= 4.0):
            issues.append(_issue(
                "beta_range",
                "warning",
                "WACC",
                f"Beta of {beta_val:.2f} appears extreme",
                "A beta below 0.2 is unusual for any public company; above 4.0 is extremely rare outside micro-caps.",
                "Verify the beta source. Use the market beta from financial data, not regression beta.",
            ))

    # Source citation on key inputs
    for field, label in [("risk_free_rate", "Risk-free rate"), ("equity_risk_premium", "ERP"), ("beta", "Beta")]:
        src = _src(wacc.get(field))
        if not src or src.lower() in _WEAK_SOURCE_MARKERS:
            issues.append(_issue(
                f"{field}_source",
                "warning",
                "WACC",
                f"{label} source citation is missing or too generic",
                "CFA Research Challenge requires specific, auditable assumption sources.",
                f"Add a concrete source for {label} (e.g. 'FRED 10-yr Treasury, Jan 2025' or 'Damodaran implied ERP').",
            ))

    # Terminal growth < WACC — checked in DCF section, but flag here if missing
    tgr = _val(_f(assumptions, "dcf", "terminal_growth_rate"))
    if computed_wacc and tgr is not None:
        if tgr >= computed_wacc:
            issues.append(_issue(
                "tgr_vs_wacc",
                "critical",
                "WACC",
                f"Terminal growth rate {tgr:.2%} ≥ WACC {computed_wacc:.2%} — DCF becomes undefined",
                "Gordon Growth Model requires g < r (discount rate). If g ≥ WACC, the terminal value formula breaks down.",
                f"Reduce terminal growth rate below WACC ({computed_wacc:.2%}). Typical limit is long-run nominal GDP ~2.5%.",
            ))

        spread = computed_wacc - tgr
        if 0 < spread < 0.04:
            issues.append(_issue(
                "wacc_tgr_spread_thin",
                "warning",
                "WACC",
                f"WACC-TGR spread is only {spread:.2%}, making terminal value highly sensitive",
                "Small WACC/TGR shifts can create outsized valuation swings near the terminal denominator.",
                "Widen the spread (e.g., slightly lower TGR or increase discount rate inputs if justified).",
            ))

    return issues


def _check_dcf(
    assumptions: dict[str, Any],
    dcf_output: dict[str, Any] | None,
    financial_data: dict[str, Any] | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    dcf = assumptions.get("dcf", {})

    tgr = _val(dcf.get("terminal_growth_rate"))
    if tgr is not None:
        if tgr > 0.035:
            issues.append(_issue(
                "tgr_too_high",
                "warning",
                "DCF",
                f"Terminal growth rate {tgr:.2%} exceeds long-run nominal GDP growth (~2.5%)",
                "A terminal growth rate above 3.5% implies the company grows faster than the economy forever.",
                "Reduce terminal growth rate to ≤2.5% unless there is a very specific justification.",
            ))
        elif tgr < 0.005:
            issues.append(_issue(
                "tgr_too_low",
                "info",
                "DCF",
                f"Terminal growth rate {tgr:.2%} is very conservative",
                "Long-run nominal GDP is ~2-2.5%. A growth rate near zero may be overly pessimistic.",
                "Consider 2.0-2.5% unless this is a declining industry.",
            ))

    # Terminal value share
    if dcf_output:
        pv_fcf = dcf_output.get("pvFCFTotal") or 0
        pv_tv_g = dcf_output.get("pvTerminalGordon") or 0
        pv_tv_e = dcf_output.get("pvTerminalExitMultiple") or 0
        pv_tv = max(pv_tv_g, pv_tv_e)
        ev = (pv_fcf + pv_tv) if (pv_fcf + pv_tv) > 0 else None
        if ev and pv_tv:
            tv_share = pv_tv / ev
            if tv_share > 0.75:
                issues.append(_issue(
                    "tv_share",
                    "warning",
                    "DCF",
                    f"Terminal value represents {tv_share:.0%} of enterprise value (limit: 75%)",
                    f"PV of terminal value: ${pv_tv:,.0f}M vs total EV: ${ev:,.0f}M",
                    "Increase near-term FCF margins or growth, OR reduce terminal growth rate to bring TV share below 75%.",
                ))

    # Revenue growth trajectory — check for consistency with forecast
    forecast = assumptions.get("forecast", {})
    rev_forecasts = forecast.get("revenue_forecasts", [])
    if rev_forecasts and financial_data:
        analyst_estimates = financial_data.get("analystRevenueEstimates", [])
        if analyst_estimates:
            rev_latest = financial_data.get("revenueLatest")
            if rev_latest and len(rev_forecasts) >= 2:
                y1_forecast = rev_forecasts[0].get("value", 0) if isinstance(rev_forecasts[0], dict) else 0
                y2_forecast = rev_forecasts[1].get("value", 0) if isinstance(rev_forecasts[1], dict) else 0
                y1_growth = (y1_forecast / rev_latest - 1) if rev_latest > 0 else None
                y2_growth = (y2_forecast / y1_forecast - 1) if y1_forecast > 0 else None

                # Compare to analyst consensus if available
                for est in analyst_estimates[:2]:
                    if isinstance(est, dict) and est.get("year") == 1 and y1_growth is not None:
                        consensus = est.get("growth")
                        if consensus and abs(y1_growth - consensus) > 0.20:
                            issues.append(_issue(
                                "revenue_vs_consensus_y1",
                                "warning",
                                "DCF",
                                f"Year-1 revenue growth {y1_growth:.1%} deviates >20% from analyst consensus {consensus:.1%}",
                                "CFA best practice weights consensus 70% for near-term (Y1-2) forecasts.",
                                "Adjust Y1 closer to analyst consensus, or document your specific thesis for deviation.",
                            ))

    # Revenue growth rates in DCF assumptions
    growth_rates = dcf.get("revenue_growth_rates", [])
    if growth_rates:
        prev_rate = None
        for i, gr in enumerate(growth_rates):
            if isinstance(gr, dict):
                rate = gr.get("value")
                if rate is not None and prev_rate is not None:
                    acceleration = rate - prev_rate
                    if acceleration > 0.10:
                        issues.append(_issue(
                            f"growth_acceleration_y{i+1}",
                            "warning",
                            "DCF",
                            f"Revenue growth accelerates by {acceleration:.0%} in year {i+1} — unusual without catalyst",
                            f"Growth jumps from {prev_rate:.1%} to {rate:.1%}",
                            "Revenue growth should typically decelerate or remain stable. Add a specific catalyst rationale if growth accelerates.",
                        ))
                if rate is not None:
                    prev_rate = rate

    # EBIT margin consistency across forecast years
    ebit_margins = forecast.get("ebit_margins", [])
    if ebit_margins and len(ebit_margins) >= 2:
        prev_margin = None
        for i, em in enumerate(ebit_margins):
            if isinstance(em, dict):
                m = em.get("value")
                if m is not None and prev_margin is not None:
                    jump = abs(m - prev_margin)
                    if jump > 0.05:  # 500bps
                        issues.append(_issue(
                            f"ebit_margin_jump_y{i+1}",
                            "warning",
                            "DCF",
                            f"EBIT margin changes by {jump:.0%} ({prev_margin:.1%}→{m:.1%}) in year {i+1} — requires justification",
                            "A >500bps year-on-year margin move needs an explicit named catalyst.",
                            "Add a rationale in the margin_thesis field, or smooth the margin path.",
                        ))
                if m is not None:
                    prev_margin = m

    # Check exit multiple reasonableness
    exit_mult = _val(dcf.get("exit_multiple"))
    if exit_mult is not None:
        if not (4.0 <= exit_mult <= 35.0):
            issues.append(_issue(
                "exit_multiple_range",
                "warning",
                "DCF",
                f"EV/EBITDA exit multiple of {exit_mult:.1f}x is outside the typical 4-35x range",
                "Extreme multiples reduce model credibility.",
                "Cross-check against peer median EV/EBITDA from the comps section.",
            ))

    return issues


def _check_ddm(
    assumptions: dict[str, Any],
    ddm_output: dict[str, Any] | None,
    financial_data: dict[str, Any] | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    ddm = assumptions.get("ddm", {})
    is_applicable = ddm.get("is_applicable", False)

    years_div = _f(financial_data or {}, "yearsOfDividendHistory") if financial_data else None
    payout = _f(financial_data or {}, "payoutRatio") if financial_data else None

    if is_applicable:
        # Validate DDM should actually be applicable
        if years_div is not None and years_div < 5:
            issues.append(_issue(
                "ddm_insufficient_history",
                "critical",
                "DDM",
                f"DDM marked applicable but only {years_div:.0f} years of dividend history (need 5+)",
                "CFA standard requires at least 5 years of consistent dividend payment for DDM to be credible.",
                "Set DDM as not applicable, or reduce DDM weight to 0 in model weights.",
            ))
        if payout is not None and not (0.15 <= payout <= 0.85):
            issues.append(_issue(
                "ddm_payout_ratio",
                "warning",
                "DDM",
                f"Payout ratio {payout:.0%} is outside the 15–85% range for meaningful DDM",
                "Very low payout: dividends are likely not the primary return driver. Very high payout: unsustainable.",
                "Consider giving DDM lower weight or documenting why dividend policy is expected to normalize.",
            ))

        # Growth < required return
        stg = _val(ddm.get("short_term_growth_rate"))
        ltg = _val(ddm.get("long_term_growth_rate"))
        req = _val(ddm.get("required_return"))
        if ltg is not None and req is not None:
            if ltg >= req:
                issues.append(_issue(
                    "ddm_growth_vs_required_return",
                    "critical",
                    "DDM",
                    f"Long-term DDM growth {ltg:.2%} ≥ required return {req:.2%} — model undefined",
                    "Gordon Growth Model requires g < r. The present value formula returns negative infinity when g ≥ r.",
                    f"Reduce long-term growth rate below required return ({req:.2%}). Typical long-run dividend growth ≤ 2.5%.",
                ))
        if stg is not None and req is not None:
            if stg >= req:
                issues.append(_issue(
                    "ddm_stg_vs_required_return",
                    "warning",
                    "DDM",
                    f"Short-term DDM growth {stg:.2%} ≥ required return {req:.2%}",
                    "While permissible in a two-stage model for a finite period, this can inflate value significantly.",
                    f"Verify short-term growth is genuinely achievable. Required return = {req:.2%}.",
                ))

    return issues


def _check_comps(
    assumptions: dict[str, Any],
    comps_output: dict[str, Any] | None,
    financial_data: dict[str, Any] | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    comps = assumptions.get("comps", {})

    peers = comps.get("selected_peers", [])
    if len(peers) < 3:
        issues.append(_issue(
            "comps_peer_count",
            "warning",
            "Comps",
            f"Only {len(peers)} peer(s) selected — investment committees expect at least 3",
            "Single-peer or two-peer comps are too easily gamed and lack statistical credibility.",
            "Add at least 2-3 more peers from the same sector with similar market cap.",
        ))

    rationale = comps.get("peer_selection_rationale", "").strip()
    if len(rationale) < 30:
        issues.append(_issue(
            "comps_peer_rationale",
            "warning",
            "Comps",
            "Peer selection rationale is too brief",
            f"Rationale: '{rationale}'",
            "Explain why each peer was chosen: same sub-sector, comparable revenue, similar business model.",
        ))

    primary = comps.get("primary_multiple", "").strip()
    if not primary:
        issues.append(_issue(
            "comps_primary_multiple",
            "warning",
            "Comps",
            "Primary valuation multiple not specified for comps",
            "Without a primary multiple, the committee cannot evaluate the comps methodology.",
            "Specify primary_multiple (e.g., 'EV/EBITDA' — capital-structure neutral and CFA-preferred).",
        ))

    # Check comps output for data quality
    if comps_output:
        implied_prices = comps_output.get("impliedPrices", [])
        applicable = [p for p in implied_prices if p.get("isApplicable") and p.get("impliedPrice")]
        if len(applicable) == 0:
            issues.append(_issue(
                "comps_no_applicable",
                "warning",
                "Comps",
                "No applicable comps multiples produced an implied price",
                "All comps multiples returned null prices, likely due to missing peer data.",
                "Verify peers have reported EV, EBITDA, and revenue. Check raw_data.xlsx Competitive_Analysis_Data sheet.",
            ))

    return issues


def _check_scenarios(
    assumptions: dict[str, Any],
    scenario_output: dict[str, Any] | None,
    blended_base_price: float | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    scenarios = assumptions.get("scenarios", {})

    # Probability sum
    probs = scenarios.get("probabilities", {})
    pb = probs.get("bear", 0)
    pbase = probs.get("base", 0)
    pbull = probs.get("bull", 0)
    prob_sum = round(pb + pbase + pbull, 4)
    if abs(prob_sum - 1.0) > 0.02:
        issues.append(_issue(
            "scenario_prob_sum",
            "critical",
            "Scenarios",
            f"Scenario probabilities sum to {prob_sum:.3f} instead of 1.0",
            f"Bear {pb:.0%} + Base {pbase:.0%} + Bull {pbull:.0%} = {prob_sum:.3f}",
            "Adjust probabilities so bear + base + bull = 100%.",
        ))

    # Bull > base > bear
    if scenario_output:
        bear_price = (scenario_output.get("bear") or {}).get("weightedPrice")
        bull_price = (scenario_output.get("bull") or {}).get("weightedPrice")
        base_price = (scenario_output.get("base") or {}).get("weightedPrice") or blended_base_price
        if bear_price and base_price and bear_price > base_price:
            issues.append(_issue(
                "scenario_bear_above_base",
                "critical",
                "Scenarios",
                f"Bear scenario price (${bear_price:.2f}) exceeds base price (${base_price:.2f})",
                "Scenarios must be ordered: bear < base < bull.",
                "Review bear-case assumptions — lower growth/margins and higher WACC drive down the bear price.",
            ))
        if bull_price and base_price and bull_price < base_price:
            issues.append(_issue(
                "scenario_bull_below_base",
                "critical",
                "Scenarios",
                f"Bull scenario price (${bull_price:.2f}) is below base price (${base_price:.2f})",
                "Scenarios must be ordered: bear < base < bull.",
                "Review bull-case assumptions — higher growth/margins and lower WACC drive up the bull price.",
            ))
        # Spread reasonableness (bull/bear spread should be material, not trivial)
        if bear_price and bull_price:
            spread = (bull_price - bear_price) / bear_price
            if spread < 0.15:
                issues.append(_issue(
                    "scenario_spread_too_narrow",
                    "info",
                    "Scenarios",
                    f"Bear-to-bull spread is only {spread:.0%} — scenarios appear undifferentiated",
                    f"Bear: ${bear_price:.2f} → Bull: ${bull_price:.2f}",
                    "Ensure bear and bull scenarios use meaningfully different assumptions, not just ±2-3%.",
                ))

    # Named catalysts check — look for generic language
    for scenario_key, label in [("bear", "Bear"), ("bull", "Bull")]:
        for driver_key in ["revenue_growth", "ebitda_margin"]:
            driver = scenarios.get(driver_key, {})
            source = str(driver.get(scenario_key, {}).get("source", "")).strip().lower() if isinstance(driver.get(scenario_key), dict) else ""
            generic_terms = {"bear", "bull", "downside", "upside", "lower", "higher", "pessimistic", "optimistic"}
            if source and all(word in generic_terms for word in source.split()):
                issues.append(_issue(
                    f"{scenario_key}_{driver_key}_generic",
                    "warning",
                    "Scenarios",
                    f"{label} {driver_key.replace('_', ' ')} source is too generic: '{source}'",
                    "CFA Research Challenge requires named, company-specific catalysts for each scenario.",
                    f"Replace generic {label.lower()} source with specific risk/catalyst (e.g. 'gold price decline below $1,800/oz').",
                ))

    return issues


def _check_investment_thesis(assumptions: dict[str, Any]) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    thesis = str(assumptions.get("investment_thesis", "")).strip()
    raw_risks = assumptions.get("key_risks", [])
    if isinstance(raw_risks, str):
        risks = [r.strip() for r in raw_risks.split("\n") if r.strip()]
    elif isinstance(raw_risks, list):
        risks = [str(r).strip() for r in raw_risks if str(r).strip()]
    else:
        risks = []

    if len(thesis) < 50:
        issues.append(_issue(
            "thesis_too_short",
            "critical" if len(thesis) < 10 else "warning",
            "Investment Thesis",
            "Investment thesis is too brief to be defensible",
            f"Thesis length: {len(thesis)} characters (minimum ~150 for a CFA-grade thesis)",
            "Expand to 3 sentences: (1) company position + competitive advantage, (2) valuation view with % upside/downside, (3) key catalyst or risk.",
        ))
    else:
        # Check for buy/hold/sell signal
        lower = thesis.lower()
        signals = ["buy", "sell", "hold", "undervalued", "overvalued", "fairly valued", "attractive", "overweight", "underweight"]
        if not any(s in lower for s in signals):
            issues.append(_issue(
                "thesis_no_recommendation",
                "warning",
                "Investment Thesis",
                "Investment thesis does not include a clear Buy/Hold/Sell recommendation",
                "An investment committee needs an actionable recommendation.",
                "Add explicit language: e.g. 'We rate this a BUY with ~25% upside to our $X price target.'",
            ))

        if not _has_numeric_text(thesis):
            issues.append(_issue(
                "thesis_lacks_quantification",
                "info",
                "Investment Thesis",
                "Investment thesis is not quantified",
                "A strong investment committee memo should include explicit upside/downside percentages or numeric catalysts.",
                "Add at least one quantitative valuation anchor and one measurable catalyst threshold.",
            ))

    # Key risks
    if not risks:
        issues.append(_issue(
            "no_key_risks",
            "warning",
            "Investment Thesis",
            "No key risks identified",
            "CFA research requires 3-5 company-specific risks.",
            "Add 3-5 specific risks (e.g. 'Gold price decline below $1,800/oz compresses margins by 800bps', not 'macroeconomic uncertainty').",
        ))
    elif len(risks) < 3:
        issues.append(_issue(
            "insufficient_risks",
            "warning",
            "Investment Thesis",
            f"Only {len(risks)} risk(s) identified — need at least 3",
            "Investment committees expect comprehensive risk coverage.",
            "Add risks covering: (1) company-specific, (2) sector/industry, (3) macro/regulatory.",
        ))
    else:
        # Check for generic risk language
        generic_risk_phrases = [
            "macroeconomic", "economic uncertainty", "recession", "market downturn",
            "interest rate", "inflation", "geopolitical",
        ]
        generic_count = 0
        for risk in risks:
            risk_text = str(risk).lower()
            if any(phrase in risk_text for phrase in generic_risk_phrases) and len(risk_text) < 60:
                generic_count += 1
        if generic_count >= 2:
            issues.append(_issue(
                "generic_risks",
                "info",
                "Investment Thesis",
                f"{generic_count} of {len(risks)} risks appear generic/macro rather than company-specific",
                "CFA Research Challenge judges specifically penalise generic risks.",
                "Replace generic risks with company-specific, quantified risks (e.g. 'Revenue decline of 15% if patent X expires without a replacement pipeline').",
            ))

    return issues


def _check_cross_model_consistency(
    assumptions: dict[str, Any],
    dcf_output: dict[str, Any] | None,
    ddm_output: dict[str, Any] | None,
    comps_output: dict[str, Any] | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []

    dcf_tgr = _val(_f(assumptions, "dcf", "terminal_growth_rate"))
    ddm_ltg = _val(_f(assumptions, "ddm", "long_term_growth_rate"))
    if dcf_tgr is not None and ddm_ltg is not None and dcf_tgr > ddm_ltg + 0.005:
        issues.append(_issue(
            "cross_model_terminal_growth_mismatch",
            "info",
            "Cross-Model Consistency",
            f"DCF terminal growth ({dcf_tgr:.2%}) exceeds DDM long-term growth ({ddm_ltg:.2%}) by more than 50 bps",
            "Mature growth assumptions should generally converge across valuation methods.",
            "Align long-run growth assumptions unless there is a specific model-based rationale.",
        ))

    dcf_price = (dcf_output or {}).get("impliedPrice")
    ddm_price = (ddm_output or {}).get("impliedPrice")
    comps_price = (comps_output or {}).get("blendedImpliedPrice")
    prices = [float(x) for x in [dcf_price, ddm_price, comps_price] if isinstance(x, (int, float)) and x > 0]
    if len(prices) >= 2:
        spread = (max(prices) - min(prices)) / min(prices)
        if spread > 0.8:
            issues.append(_issue(
                "cross_model_price_dispersion",
                "warning",
                "Cross-Model Consistency",
                f"Model-implied values are widely dispersed ({spread:.0%} spread between min and max)",
                "Large divergence can indicate inconsistent assumptions across methods or unstable model calibration.",
                "Reconcile key assumptions (growth, margins, payout, discount rates) before final recommendation.",
            ))

    return issues


def _check_model_weights(
    assumptions: dict[str, Any],
    dcf_output: dict[str, Any] | None,
    ddm_output: dict[str, Any] | None,
    financial_data: dict[str, Any] | None,
) -> list[CritiqueIssue]:
    issues: list[CritiqueIssue] = []
    weights = assumptions.get("valuation_config", {})
    if not weights:
        return issues  # Config is optional

    model_weights = weights.get("model_weights", {})
    ddm_wt = model_weights.get("ddm", 0)
    dcf_wt = model_weights.get("dcf", 0)
    comps_wt = model_weights.get("comps", 0)
    total = round(ddm_wt + dcf_wt + comps_wt, 4)

    if abs(total - 1.0) > 0.02:
        issues.append(_issue(
            "model_weights_sum",
            "critical",
            "Blend Weights",
            f"Model weights sum to {total:.3f} instead of 1.0",
            f"DCF {dcf_wt:.0%} + Comps {comps_wt:.0%} + DDM {ddm_wt:.0%} = {total:.3f}",
            "Adjust weights so dcf + comps + ddm = 100%.",
        ))

    # DDM weight vs applicability
    ddm_applicable = (assumptions.get("ddm") or {}).get("is_applicable", False)
    if ddm_wt > 0.05 and not ddm_applicable:
        issues.append(_issue(
            "ddm_weight_not_applicable",
            "warning",
            "Blend Weights",
            f"DDM has {ddm_wt:.0%} weight but DDM is marked not applicable",
            "Including DDM weight for a non-dividend paying company distorts the blended price.",
            "Set DDM weight to 0 when DDM is not applicable.",
        ))

    return issues


# ── main critique function ────────────────────────────────────────────────────

def run_critique(
    ticker: str,
    assumptions: dict[str, Any],
    dcf_output: dict[str, Any] | None = None,
    ddm_output: dict[str, Any] | None = None,
    comps_output: dict[str, Any] | None = None,
    scenario_output: dict[str, Any] | None = None,
    financial_data: dict[str, Any] | None = None,
) -> CritiqueReport:
    """Run all CFA critique checks and return a structured report."""

    if not isinstance(ticker, str) or not ticker.strip():
        raise ValueError("ticker must be a non-empty string")
    if not isinstance(assumptions, dict):
        raise ValueError("assumptions must be a dict")

    blended_base = None
    if dcf_output:
        blended_base = dcf_output.get("impliedPrice")

    # Run all check groups
    wacc_issues = _check_wacc(assumptions, dcf_output)
    dcf_issues = _check_dcf(assumptions, dcf_output, financial_data)
    ddm_issues = _check_ddm(assumptions, ddm_output, financial_data)
    comps_issues = _check_comps(assumptions, comps_output, financial_data)
    scenario_issues = _check_scenarios(assumptions, scenario_output, blended_base)
    thesis_issues = _check_investment_thesis(assumptions)
    weight_issues = _check_model_weights(assumptions, dcf_output, ddm_output, financial_data)
    consistency_issues = _check_cross_model_consistency(assumptions, dcf_output, ddm_output, comps_output)

    all_issues = (
        wacc_issues + dcf_issues + ddm_issues + comps_issues
        + scenario_issues + thesis_issues + weight_issues + consistency_issues
    )

    # Build categories
    def _cat(name: str, icon: str, issues: list[CritiqueIssue]) -> CritiqueCategory:
        if any(i.severity == "critical" for i in issues):
            grade = "fail"
        elif any(i.severity == "warning" for i in issues):
            grade = "warn"
        else:
            grade = "pass"
        return CritiqueCategory(name=name, icon=icon, grade=grade, issues=issues)

    categories = [
        _cat("WACC Construction", "📐", wacc_issues),
        _cat("DCF Model", "💹", dcf_issues),
        _cat("DDM Model", "💰", ddm_issues),
        _cat("Comparable Companies", "🏢", comps_issues),
        _cat("Scenario Analysis", "🎯", scenario_issues),
        _cat("Investment Thesis & Risks", "📝", thesis_issues),
        _cat("Blend Weights", "⚖️", weight_issues),
        _cat("Cross-Model Consistency", "🔎", consistency_issues),
    ]

    # Score
    criticals = sum(1 for i in all_issues if i.severity == "critical")
    warnings = sum(1 for i in all_issues if i.severity == "warning")
    infos = sum(1 for i in all_issues if i.severity == "info")
    score = max(0, 100 - criticals * 20 - warnings * 5 - infos * 1)

    if score >= 90:
        grade: str = "A"
    elif score >= 75:
        grade = "B"
    elif score >= 60:
        grade = "C"
    elif score >= 45:
        grade = "D"
    else:
        grade = "F"

    # Summary
    if criticals > 0:
        summary = f"{criticals} critical issue(s) must be resolved before presenting to a CFA. {warnings} warning(s) also flagged."
    elif warnings > 0:
        summary = f"No critical issues. {warnings} warning(s) should be addressed for a clean CFA presentation."
    else:
        summary = "All core CFA defensibility checks passed. Valuation is presentation-ready."

    auto_refinable = len(all_issues) > 0

    return CritiqueReport(
        ticker=ticker,
        overall_grade=grade,  # type: ignore[arg-type]
        overall_score=score,
        categories=categories,
        issues=all_issues,
        summary=summary,
        auto_refinable=auto_refinable,
    )
