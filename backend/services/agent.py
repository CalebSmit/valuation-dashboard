"""Claude API agent for generating CFA-grade valuation assumptions.

Two modes:
- Standard: Single structured output call with enriched financial context (~$0.012/run)
- Deep Research: Multi-turn with web_search for real citations (~$0.03-0.08/run)
"""
from __future__ import annotations

import json
from typing import Any

import anthropic

# ============================================================
# CFA-GRADE SYSTEM PROMPT
# ============================================================

SYSTEM_PROMPT = """You are a CFA charterholder performing a fundamental equity analysis. Your valuation
must be defensible in a CFA Institute Research Challenge or investment committee review.

METHODOLOGY FRAMEWORK:

1. REVENUE PROJECTION (Top-Down + Bottom-Up Reconciliation)
   - Start with the analyst consensus revenue estimates (provided in analystRevenueEstimates) as your anchor
   - Cross-check against the historical revenue CAGR from the provided revenueHistory
   - Check if EPS estimates are being revised up or down (epsTrends) — upward revisions support higher growth
   - Years 1-2: weight consensus estimates 70%, historical trend 30%
   - Years 3-5: fade toward long-term industry average growth rate
   - If the company has consistently beaten estimates (earningsHistory), you may add a modest beat factor
   - Source each year's growth rate: cite "Analyst consensus" for Y1-2, "Historical CAGR fade" for Y3-5

2. MARGIN ANALYSIS (DuPont Framework)
   - Use the actual EBITDA margin from ebitdaHistory (most recent year) as starting point
   - Stabilized margin = 3-year average unless a structural shift is underway
   - Check operatingMargin and profitMargin from valuation metrics for cross-validation
   - Consider: operating leverage (high fixed costs → margins expand with revenue growth),
     competitive dynamics, input cost trends for this industry

3. WACC CONSTRUCTION (Pure CAPM)
    - Risk-free rate: Use the provided 10-Year Treasury from yieldCurve.10yr as-is.
   - Beta: Use beta (the market beta from the data). Do not use regressionBeta.
     - ERP: Use Damodaran's current implied equity risk premium. As of 2025, approximately 4.2-4.6% (0.042-0.046 in decimal form).
     Cite "Damodaran implied ERP, January 2025"
   - Size premium: 0% for large-cap (market cap > $10B), 1-2% for mid-cap, 2-4% for small-cap
   - Cost of debt: Use capitalStructure.impliedCostOfDebt if available (interest expense / total debt).
     Otherwise estimate from credit spread: risk-free + 1-3% depending on leverage
   - Capital weights: Use MARKET VALUE weights from capitalStructure (debtToCapitalMarket, equityToCapitalMarket).
     This is CFA standard — never use book value weights for equity
   - Sanity check: WACC should be 6-14% for developed market equities. If outside this range, explain why.

4. TERMINAL VALUE (Dual Method Required)
   - Gordon Growth: terminal growth rate = min(long-run nominal GDP growth ~2.5%, reinvestment rate x ROIC)
     MUST be strictly less than WACC. Default 2.0-2.5%.
   - Exit Multiple: use the peer median EV/EBITDA from the provided competitors data. Justify if deviating.
   - You MUST provide both methods. The blended implied price weights Exit Multiple 60%, Gordon 40%.

5. DDM APPLICABILITY (Strict Criteria)
   - Check yearsOfDividendHistory: need 5+ years
   - Check payoutRatio: should be 20-80% for DDM to be meaningful
   - Check paymentFrequency: must be regular (Quarterly or Semi-Annual)
   - If applicable, required return = your CAPM cost of equity (same as WACC equity component)
   - Two-stage: short-term growth from dividendGrowth3yr or dividendGrowth5yr, long-term = terminal growth

6. COMPARABLE COMPANY ANALYSIS
   - The peer data is in the competitors array. Compute EV/EBITDA for each peer: enterpriseValue / ebitdaTTM
   - Use peer median (not mean) for each multiple
   - Validate peers share similar: industry, size (0.5x-2x market cap), growth profile
   - Primary multiple: EV/EBITDA (capital-structure neutral). Secondary: P/E.
   - Note if subject deserves premium/discount vs peers and why

7. SCENARIO ANALYSIS (Event-Driven, Not Arbitrary)
   - BEAR: Name the specific downside risk (e.g., "commodity price decline", "margin compression from
     competition", "regulatory headwind"). Quantify: revenue growth -X%, margin -Y bps, multiple de-rates to Z.
   - BASE: Your best estimate (matches your DCF base case assumptions)
   - BULL: Name the specific upside catalyst (e.g., "new product launch", "market share gain",
     "commodity price recovery"). Quantify the upside impact on each driver.
   - Each scenario driver must have a rationale — not just "bear = lower"

8. INVESTMENT THESIS (3 sentences max)
   - Sentence 1: What the company does and its competitive position
   - Sentence 2: Your valuation view (overvalued/undervalued/fairly valued) with approximate % upside/downside
   - Sentence 3: The single most important catalyst or risk

9. KEY RISKS (3-5 specific risks, not generic)
   - Each risk should be specific to this company/industry, not "macroeconomic uncertainty"
   - Good: "Gold price decline below $1,800/oz would compress margins by 800bps"
   - Bad: "Economic downturn could hurt revenue"

10. CROSS-VALIDATION (Perform silently, adjust if failed)
    - Does your implied DCF price fall within ±30% of analystTargetMean? If not, re-examine assumptions.
    - Does terminal value represent less than 75% of enterprise value? If not, your near-term FCFs may be too low.
    - Is your implied forward P/E (implied price / forward EPS) reasonable vs peer median P/E?

CONFIDENCE TAGGING:
- "high": Directly from provided data or consensus estimates (e.g., risk-free rate from FRED, beta from regression)
- "medium": Extrapolated from trends or industry benchmarks (e.g., margin fade, growth deceleration)
- "low": Estimated with limited data — flag for user review (e.g., size premium, NWC assumption)

CRITICAL: All rates must be in DECIMAL form (0.08 means 8%, not 8).
CRITICAL: The provided FRED yields, dividend yields, margins, and growth rates are ALREADY in decimal form
(e.g., riskFreeRate10yr: 0.0406 means 4.06%). Do NOT divide by 100 again.
CRITICAL: Every assumption MUST have a specific source citation in the source field.

11. 3-STATEMENT FORECAST (Required)
    You MUST provide a 5-year revenue forecast, EBIT margins, and EBITDA margins in the forecast section.
    REVENUE: Return ABSOLUTE values (same units as revenueLatest). Your revenue_growth_rates in the DCF
    section should be CONSISTENT with these forecasts (growth_rate = forecast_revenue / prior_revenue - 1).
    MARGINS: EBIT and EBITDA margins as decimals (0.25 = 25%). These should tell a story.
    TAX RATE: Set the projected effective tax rate.
    ACCOUNT OVERRIDES: Only override Python-computed assumptions (capex_pct_revenue, dso_days, etc.)
    if you have specific information suggesting the historical pattern won't hold.

12. VALUATION CONFIG & BLEND WEIGHTS (optional but recommended)
    - Recommend terminal_value_method: "blended" for most companies. Use "gordon" only if
      you have high confidence in the terminal growth rate. Use "exit" for sectors where
      transaction multiples are more reliable (e.g., real estate, banking).
    - Recommend cash_flow_basis: "fcff" for most companies. Use "fcfe" for financial
      institutions where capital structure is integral to the business model.
    - Recommend discounting_convention: "end" unless the company has very seasonal cash
      flows or you want to be more precise (CFA Level II recommends mid-year).
    - model_weights:
      - For stable dividend payers (DDM applicable): dcf 0.40, comps 0.30, ddm 0.30
      - For growth names (no dividend): dcf 0.60, comps 0.40, ddm 0.00
      - For mature with modest dividend: dcf 0.50, comps 0.30, ddm 0.20
      - Adjust based on data quality — if comps peers are weak, reduce comps weight
    - dcf_sub_weights: Default to blended=1.0 unless you have reason to favor one method
    - Explain your reasoning in weights_rationale

13. SELF-REVIEW (Mandatory — performed automatically after you call set_valuation_assumptions)
    After you submit your assumptions you will receive a self-review prompt. You MUST check:
    a) MARGIN CONSISTENCY: Your projected EBIT margins must be compatible with the historical
       operating cost structure. The income statement identity is:
       EBIT margin ≈ 1 − COGS% − R&D% − SG&A% (with modest room for leverage/improvement).
       If your EBIT margin implies a COGS that would be negative (i.e. R&D% + SG&A% alone
       already exceed 1 − EBIT_margin), flag it and revise EBIT margin downward.
    b) MARGIN TRAJECTORY: Each year's EBIT/EBITDA margin should step logically from the
       historical base. A jump of more than 500bps year-on-year requires an explicit catalyst.
    c) REVENUE SANITY: Projected revenues should be within ±20% of analyst consensus for Y1-2.
       If you deviate, state why. Y3-5 should fade toward industry long-run growth.
    d) WACC BOUNDS: Final WACC must be 6-14% for developed market equities. Flag if outside.
    e) TERMINAL VALUE SHARE: TV should be < 75% of enterprise value. If higher, near-term FCFs
       may be too pessimistic — consider raising margins or growth rates.
    If any check fails, call set_valuation_assumptions again with corrected values."""

# ============================================================
# DEEP RESEARCH SYSTEM PROMPT (adds web search instructions)
# ============================================================

DEEP_RESEARCH_ADDENDUM = """

ADDITIONAL INSTRUCTIONS FOR DEEP RESEARCH MODE:

You have access to web_search. Use it strategically (3-5 searches max) to:

1. SEARCH: "{ticker} latest earnings call key takeaways {current_year}"
   → Extract management guidance on revenue, margins, CapEx plans
   → Update your revenue growth and margin assumptions if guidance differs from consensus

2. SEARCH: "{ticker} analyst consensus price target {current_year}"
   → Cross-reference your DCF implied price against sell-side consensus
   → Note any major divergence in your rationale

3. SEARCH: "Damodaran equity risk premium {current_year}"
   → Get the current implied ERP from Damodaran's website
   → Use this exact value instead of the default range

4. SEARCH: "{industry} industry outlook growth rate {current_year}"
   → Validate your terminal growth rate and long-term revenue fade assumptions

5. SEARCH (optional): "{ticker} risk factors 10-K SEC filing"
   → Identify company-specific risks for the key_risks section

After searching, REVISE your assumptions to incorporate the findings.
Cite the actual search results in your source fields (e.g., "Q3 2024 earnings call transcript").
"""

# ============================================================
# TOOL SCHEMA (same for both modes)
# ============================================================

ASSUMPTIONS_TOOL = {
    "name": "set_valuation_assumptions",
    "description": "Set all valuation assumptions for DCF, DDM, and comps analysis with sources",
    "input_schema": {
        "type": "object",
        "required": ["dcf", "wacc", "ddm", "comps", "scenarios", "forecast", "investment_thesis", "key_risks"],
        "properties": {
            "dcf": {
                "type": "object",
                "required": ["revenue_growth_rates", "ebitda_margin", "capex_pct_revenue",
                             "nwc_pct_revenue", "tax_rate", "terminal_growth_rate", "exit_multiple"],
                "properties": {
                    "revenue_growth_rates": {
                        "type": "array",
                        "items": {"$ref": "#/$defs/sourced_assumption"},
                        "description": "5 years of projected revenue growth rates (decimal, e.g. 0.08 = 8%)"
                    },
                    "ebitda_margin": {"$ref": "#/$defs/sourced_assumption"},
                    "capex_pct_revenue": {"$ref": "#/$defs/sourced_assumption"},
                    "nwc_pct_revenue": {"$ref": "#/$defs/sourced_assumption"},
                    "tax_rate": {"$ref": "#/$defs/sourced_assumption"},
                    "terminal_growth_rate": {"$ref": "#/$defs/sourced_assumption"},
                    "exit_multiple": {"$ref": "#/$defs/sourced_assumption"},
                    "mid_year_convention": {"type": "boolean", "default": False},
                }
            },
            "wacc": {
                "type": "object",
                "required": ["risk_free_rate", "equity_risk_premium", "beta", "size_premium",
                             "cost_of_debt", "debt_weight", "equity_weight", "tax_rate"],
                "properties": {
                    "risk_free_rate": {"$ref": "#/$defs/sourced_assumption"},
                    "equity_risk_premium": {"$ref": "#/$defs/sourced_assumption"},
                    "beta": {"$ref": "#/$defs/sourced_assumption"},
                    "size_premium": {"$ref": "#/$defs/sourced_assumption"},
                    "cost_of_debt": {"$ref": "#/$defs/sourced_assumption"},
                    "debt_weight": {"$ref": "#/$defs/sourced_assumption"},
                    "equity_weight": {"$ref": "#/$defs/sourced_assumption"},
                    "tax_rate": {"$ref": "#/$defs/sourced_assumption"},
                }
            },
            "ddm": {
                "type": "object",
                "required": ["is_applicable", "applicability_reason"],
                "properties": {
                    "is_applicable": {"type": "boolean"},
                    "applicability_reason": {"type": "string"},
                    "short_term_growth_rate": {"$ref": "#/$defs/sourced_assumption_nullable"},
                    "long_term_growth_rate": {"$ref": "#/$defs/sourced_assumption_nullable"},
                    "required_return": {"$ref": "#/$defs/sourced_assumption_nullable"},
                    "high_growth_years": {"type": "integer", "default": 5},
                }
            },
            "comps": {
                "type": "object",
                "required": ["selected_peers", "peer_selection_rationale", "primary_multiple"],
                "properties": {
                    "selected_peers": {"type": "array", "items": {"type": "string"}},
                    "peer_selection_rationale": {"type": "string"},
                    "primary_multiple": {"type": "string"},
                    "multiple_rationale": {"type": "string", "default": ""},
                    "multiple_weights": {
                        "type": "object",
                        "properties": {
                            "ev_ebitda": {"type": "number", "default": 0.40},
                            "pe": {"type": "number", "default": 0.30},
                            "ev_sales": {"type": "number", "default": 0.20},
                            "pb": {"type": "number", "default": 0.10},
                        },
                        "default": {
                            "ev_ebitda": 0.40,
                            "pe": 0.30,
                            "ev_sales": 0.20,
                            "pb": 0.10,
                        },
                    },
                }
            },
            "scenarios": {
                "type": "object",
                "required": ["revenue_growth", "ebitda_margin", "exit_multiple", "wacc"],
                "properties": {
                    "revenue_growth": {"$ref": "#/$defs/scenario_drivers"},
                    "ebitda_margin": {"$ref": "#/$defs/scenario_drivers"},
                    "exit_multiple": {"$ref": "#/$defs/scenario_drivers"},
                    "wacc": {"$ref": "#/$defs/scenario_drivers"},
                    "probabilities": {
                        "type": "object",
                        "properties": {
                            "bear": {"type": "number", "default": 0.25},
                            "base": {"type": "number", "default": 0.50},
                            "bull": {"type": "number", "default": 0.25},
                        },
                        "default": {
                            "bear": 0.25,
                            "base": 0.50,
                            "bull": 0.25,
                        },
                    },
                }
            },
            "forecast": {
                "type": "object",
                "description": "5-year financial forecast: AI owns Revenue, EBIT/EBITDA margins, and tax rate",
                "required": ["revenue_forecasts", "ebit_margins", "ebitda_margins",
                             "effective_tax_rate", "revenue_thesis", "margin_thesis"],
                "properties": {
                    "revenue_forecasts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["year", "value", "confidence", "rationale"],
                            "properties": {
                                "year": {"type": "integer", "minimum": 1, "maximum": 5},
                                "value": {"type": "number", "description": "Absolute revenue value (same units as revenueLatest)"},
                                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                                "rationale": {"type": "string"},
                            },
                        },
                        "minItems": 5, "maxItems": 5,
                        "description": "5 years of absolute revenue forecasts",
                    },
                    "ebit_margins": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["year", "value", "confidence", "rationale"],
                            "properties": {
                                "year": {"type": "integer"},
                                "value": {"type": "number", "description": "EBIT margin as decimal (0.25 = 25%)"},
                                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                                "rationale": {"type": "string"},
                            },
                        },
                        "minItems": 5, "maxItems": 5,
                    },
                    "ebitda_margins": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["year", "value", "confidence", "rationale"],
                            "properties": {
                                "year": {"type": "integer"},
                                "value": {"type": "number", "description": "EBITDA margin as decimal"},
                                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                                "rationale": {"type": "string"},
                            },
                        },
                        "minItems": 5, "maxItems": 5,
                    },
                    "effective_tax_rate": {
                        "type": "number",
                        "description": "Projected effective tax rate as decimal",
                    },
                    "account_overrides": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["account", "new_value", "rationale"],
                            "properties": {
                                "account": {"type": "string"},
                                "new_value": {"type": "number"},
                                "rationale": {"type": "string"},
                            },
                        },
                        "description": "Optional overrides of Python-computed accounts (capex_pct_revenue, dso_days, etc.)",
                    },
                    "revenue_thesis": {"type": "string", "maxLength": 500},
                    "margin_thesis": {"type": "string", "maxLength": 500},
                    "key_assumptions": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
                },
            },
            "investment_thesis": {"type": "string", "maxLength": 500},
            "key_risks": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
            "valuation_config": {
                "type": "object",
                "description": "Recommended DCF configuration and blend weights for the final price target",
                "properties": {
                    "terminal_value_method": {
                        "type": "string",
                        "enum": ["blended", "exit", "gordon"],
                        "default": "blended",
                        "description": "Which terminal value method to emphasize"
                    },
                    "cash_flow_basis": {
                        "type": "string",
                        "enum": ["fcff", "fcfe"],
                        "default": "fcff",
                        "description": "FCFF (discount at WACC) or FCFE (discount at cost of equity)"
                    },
                    "discounting_convention": {
                        "type": "string",
                        "enum": ["end", "mid"],
                        "default": "end"
                    },
                    "dcf_sub_weights": {
                        "type": "object",
                        "properties": {
                            "blended": {"type": "number", "default": 1.0},
                            "exit_only": {"type": "number", "default": 0.0},
                            "gordon_only": {"type": "number", "default": 0.0},
                        }
                    },
                    "model_weights": {
                        "type": "object",
                        "properties": {
                            "dcf": {"type": "number", "default": 0.50},
                            "comps": {"type": "number", "default": 0.30},
                            "ddm": {"type": "number", "default": 0.20},
                        }
                    },
                    "weights_rationale": {
                        "type": "string",
                        "description": "CFA-grade explanation of why these weights were chosen"
                    }
                },
            },
        },
        "$defs": {
            "sourced_assumption": {
                "type": "object",
                "required": ["value", "source"],
                "properties": {
                    "value": {"type": "number"},
                    "source": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"], "default": "medium"},
                    "rationale": {"type": "string", "default": ""},
                }
            },
            "sourced_assumption_nullable": {
                "oneOf": [
                    {"$ref": "#/$defs/sourced_assumption"},
                    {"type": "null"},
                ]
            },
            "scenario_drivers": {
                "type": "object",
                "required": ["bear", "base", "bull"],
                "properties": {
                    "bear": {"$ref": "#/$defs/sourced_assumption"},
                    "base": {"$ref": "#/$defs/sourced_assumption"},
                    "bull": {"$ref": "#/$defs/sourced_assumption"},
                }
            }
        }
    }
}

# Exported for use by other provider adapters (Perplexity JSON mode, Gemini function calling)
ASSUMPTIONS_JSON_SCHEMA = ASSUMPTIONS_TOOL["input_schema"]


# ============================================================
# SELF-REVIEW PROMPT
# ============================================================

def _build_self_review_message(assumptions: dict[str, Any], historical_ratios: dict[str, Any]) -> str:
    """Build the self-review prompt injected after set_valuation_assumptions is called."""
    ebit_margins = [m["value"] for m in sorted(
        assumptions.get("forecast", {}).get("ebit_margins", []),
        key=lambda x: x.get("year", 0),
    )]
    ebitda_margins = [m["value"] for m in sorted(
        assumptions.get("forecast", {}).get("ebitda_margins", []),
        key=lambda x: x.get("year", 0),
    )]
    revenue_forecasts = [f["value"] for f in sorted(
        assumptions.get("forecast", {}).get("revenue_forecasts", []),
        key=lambda x: x.get("year", 0),
    )]

    cogs_pct = historical_ratios.get("cogs_pct_revenue", "unknown")
    rnd_pct = historical_ratios.get("rnd_pct_revenue", "unknown")
    sga_pct = historical_ratios.get("sga_pct_revenue", "unknown")
    base_ebit = historical_ratios.get("base_ebit_margin", "unknown")
    base_ebitda = historical_ratios.get("base_ebitda_margin", "unknown")
    base_revenue = historical_ratios.get("base_revenue", "unknown")

    # Compute implied minimum EBIT margin given historical opex (as a sanity floor)
    try:
        min_ebit = 1.0 - float(cogs_pct) - float(rnd_pct) - float(sga_pct)
        floor_note = f"Historical opex floor implies EBIT margin ≥ {min_ebit:.1%} before any leverage gains. If you project below this, explain why costs are rising."
    except (TypeError, ValueError):
        floor_note = "Could not compute opex floor — verify margin assumptions manually."

    return f"""You just submitted valuation assumptions. Please self-review them against the checks in section 13 of your instructions.

HISTORICAL RATIOS (3-year averages from actual financials):
  COGS % Revenue:      {cogs_pct if isinstance(cogs_pct, str) else f'{cogs_pct:.1%}'}
  R&D % Revenue:       {rnd_pct if isinstance(rnd_pct, str) else f'{rnd_pct:.1%}'}
  SG&A % Revenue:      {sga_pct if isinstance(sga_pct, str) else f'{sga_pct:.1%}'}
  Base EBIT margin:    {base_ebit if isinstance(base_ebit, str) else f'{base_ebit:.1%}'}
  Base EBITDA margin:  {base_ebitda if isinstance(base_ebitda, str) else f'{base_ebitda:.1%}'}
  Base revenue:        {base_revenue if isinstance(base_revenue, str) else f'{base_revenue:,.0f}'}

YOUR SUBMITTED FORECAST:
  EBIT margins (Y1-5):   {[f'{m:.1%}' for m in ebit_margins]}
  EBITDA margins (Y1-5): {[f'{m:.1%}' for m in ebitda_margins]}
  Revenue forecasts:     {[f'{r:,.0f}' for r in revenue_forecasts]}

CONSISTENCY CHECK:
  {floor_note}

For each check (a–e from section 13), state PASS or FAIL with one sentence of reasoning.
If any check FAILs, call set_valuation_assumptions again with corrected values.
If all checks PASS, reply with exactly: "SELF-REVIEW COMPLETE — no revisions needed." """


async def _run_self_review(
    client: anthropic.Anthropic,
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    initial_assumptions: dict[str, Any],
    historical_ratios: dict[str, Any],
    extra_tools: list[dict[str, Any]],
    on_step: Any,
) -> dict[str, Any]:
    """Inject a self-review turn after set_valuation_assumptions is called.

    Returns either revised assumptions (if the AI called the tool again)
    or the original assumptions (if all checks passed).
    """
    if on_step:
        on_step("Running self-review of forecast assumptions...")

    review_messages = list(messages) + [{
        "role": "user",
        "content": _build_self_review_message(initial_assumptions, historical_ratios),
    }]

    tools = extra_tools + [ASSUMPTIONS_TOOL]
    response = client.messages.create(
        model=model,
        max_tokens=4000,
        system=system,
        messages=review_messages,
        tools=tools,
        tool_choice={"type": "any"},
    )

    for block in response.content:
        if hasattr(block, "type") and block.type == "tool_use" and block.name == "set_valuation_assumptions":
            if on_step:
                on_step("Self-review found issues — assumptions revised")
            return dict(block.input)

    if on_step:
        on_step("Self-review passed — no revisions needed")
    return initial_assumptions


# Mandatory peer selection instruction — appended to user message in dashboard flow
PEER_SELECTION_INSTRUCTION = (
    "\n\nPEER SELECTION (REQUIRED): You MUST select 3-5 comparable companies in "
    "comps.selected_peers. Choose peers that a CFA analyst would defend:\n"
    "- Same sector and industry (or adjacent if few direct peers exist)\n"
    "- Similar size (0.5x-2x market cap preferred)\n"
    "- Similar growth profile and business model\n"
    "- Publicly traded with available financial data\n"
    "Use standard ticker symbols (e.g., MSFT, GOOGL, META — not abbreviations).\n"
    "Your peer selections will be used to fetch live market data for the comps analysis."
)


# ============================================================
# STANDARD MODE (single structured output call)
# ============================================================

async def run_standard_agent(
    ticker: str,
    financial_summary: dict[str, Any],
    api_key: str,
    historical_ratios: dict[str, Any] | None = None,
    on_step: Any = None,
) -> dict[str, Any]:
    """Single-shot CFA-grade assumption generation from financial data."""
    client = anthropic.Anthropic(api_key=api_key)

    summary_json = json.dumps(financial_summary, indent=2, default=str)

    user_message = (
        f"Generate complete CFA-grade valuation assumptions for {ticker}.\n\n"
        f"Financial Data Summary:\n{summary_json}"
        f"{PEER_SELECTION_INSTRUCTION}"
    )

    messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=messages,
        tools=[ASSUMPTIONS_TOOL],
        tool_choice={"type": "tool", "name": "set_valuation_assumptions"},
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "set_valuation_assumptions":
            initial = dict(block.input)
            if historical_ratios:
                messages.append({"role": "assistant", "content": response.content})
                return await _run_self_review(
                    client=client,
                    model="claude-sonnet-4-20250514",
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    initial_assumptions=initial,
                    historical_ratios=historical_ratios,
                    extra_tools=[],
                    on_step=on_step,
                )
            return initial

    raise ValueError("Claude did not return structured assumptions")


# ============================================================
# DEEP RESEARCH MODE (uses Anthropic's native web_search tool)
# ============================================================

async def run_deep_research_agent(
    ticker: str,
    financial_summary: dict[str, Any],
    api_key: str,
    on_step: Any = None,
    historical_ratios: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Uses Anthropic's built-in web_search server tool for real grounded citations.

    The web_search tool is a server-side tool managed by Anthropic — it performs
    real web searches and returns grounded results with URLs. No custom search
    API needed.
    """
    from datetime import date
    client = anthropic.Anthropic(api_key=api_key)

    summary_json = json.dumps(financial_summary, indent=2, default=str)

    current_year = str(date.today().year)
    industry = financial_summary.get("industry", "")

    full_system = SYSTEM_PROMPT + DEEP_RESEARCH_ADDENDUM.replace(
        "{ticker}", ticker
    ).replace(
        "{current_year}", current_year
    ).replace(
        "{industry}", industry
    )

    user_message = (
        f"Generate complete CFA-grade valuation assumptions for {ticker}.\n"
        f"Use the web_search tool to validate key assumptions with real citations.\n"
        f"Search for: (1) latest earnings guidance, (2) analyst consensus, "
        f"(3) Damodaran ERP, (4) industry outlook. Then set assumptions.\n\n"
        f"Financial Data Summary:\n{summary_json}"
        f"{PEER_SELECTION_INSTRUCTION}"
    )

    # Anthropic's native web_search is a server-side tool specified in the tools array
    # See: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search
    web_search_tool = {
        "type": "web_search_20250305",
        "name": "web_search",
        "max_uses": 5,
    }

    if on_step:
        on_step("Starting deep research with web search...")

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=16000,
        system=full_system,
        messages=[{"role": "user", "content": user_message}],
        tools=[web_search_tool, ASSUMPTIONS_TOOL],
        tool_choice={"type": "any"},
    )

    # The response may contain multiple content blocks:
    # web_search_tool_result blocks (from server-side search), text blocks, and tool_use blocks.
    # We need to handle multi-turn if Claude hasn't called set_valuation_assumptions yet.
    messages = [{"role": "user", "content": user_message}]
    max_turns = 6

    for turn in range(max_turns):
        # Check if final assumptions were returned
        for block in response.content:
            if hasattr(block, 'type') and block.type == "tool_use" and block.name == "set_valuation_assumptions":
                if on_step:
                    on_step("Assumptions set with web-sourced citations")
                initial = dict(block.input)
                if historical_ratios:
                    messages.append({"role": "assistant", "content": response.content})
                    return await _run_self_review(
                        client=client,
                        model="claude-sonnet-4-20250514",
                        system=full_system,
                        messages=messages,
                        initial_assumptions=initial,
                        historical_ratios=historical_ratios,
                        extra_tools=[web_search_tool],
                        on_step=on_step,
                    )
                return initial

        # Log any search activity
        for block in response.content:
            if hasattr(block, 'type') and block.type == "web_search_tool_result":
                if on_step:
                    on_step(f"Web search completed")
            elif hasattr(block, 'type') and block.type == "text" and block.text:
                text_preview = block.text[:100].replace('\n', ' ')
                if on_step and text_preview.strip():
                    on_step(f"Analyzing: {text_preview}...")

        # Continue conversation — ask Claude to finalize
        messages.append({"role": "assistant", "content": response.content})
        messages.append({
            "role": "user",
            "content": "Now call the set_valuation_assumptions tool with your final assumptions based on the research.",
        })

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8000,
            system=full_system,
            messages=messages,
            tools=[web_search_tool, ASSUMPTIONS_TOOL],
            tool_choice={"type": "any"},
        )

    raise ValueError("Deep research agent did not produce assumptions within turn limit")


# ============================================================
# MAIN ENTRY POINT
# ============================================================

async def run_valuation_agent(
    ticker: str,
    financial_summary: dict[str, Any],
    api_key: str,
    provider: str = "anthropic",
    deep_research: bool = False,
    on_step: Any = None,
    historical_ratios: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Route to the selected provider's adapter."""
    from services.providers import ADAPTERS

    adapter = ADAPTERS.get(provider)
    if adapter is None:
        raise ValueError(f"Unknown provider: {provider}. Choose: anthropic, perplexity, gemini")

    return await adapter.generate_assumptions(
        ticker=ticker,
        financial_summary=financial_summary,
        api_key=api_key,
        deep_research=deep_research,
        on_step=on_step,
        historical_ratios=historical_ratios,
    )
