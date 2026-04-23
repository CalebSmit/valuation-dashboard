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

SYSTEM_PROMPT = """# Audited: ~40% reduction vs original
You are a CFA charterholder performing a fundamental equity analysis defensible in a CFA
Institute Research Challenge or investment committee review.

METHODOLOGY FRAMEWORK:

1. REVENUE PROJECTION (Top-Down + Bottom-Up)
   - Anchor on analystRevenueEstimates; cross-check against historical revenue CAGR
   - Upward epsTrends revisions support higher growth; consistent beats (earningsHistory) allow a modest beat factor
   - Y1-2: weight consensus 70% / historical trend 30%. Y3-5: fade toward long-run industry growth.
   - Source Y1-2 as "Analyst consensus"; Y3-5 as "Historical CAGR fade"

2. MARGIN ANALYSIS (DuPont)
   - Start from most-recent ebitdaHistory; stabilized = 3-yr average unless structural shift
   - Cross-validate with operatingMargin / profitMargin
   - Consider operating leverage, competitive dynamics, industry input costs

3. WACC (Pure CAPM, Market-Value Weights)
   - Risk-free: yieldCurve.10yr as-is
   - Beta: use `beta` (market beta), not regressionBeta
   - ERP: Damodaran implied ERP, ~4.2-4.6% in 2025 (decimal 0.042-0.046). Cite "Damodaran implied ERP, January 2025"
   - Size premium: 0% large-cap (>$10B), 1-2% mid, 2-4% small
   - Cost of debt: capitalStructure.impliedCostOfDebt if available; else risk-free + 1-3% credit spread
   - Weights: MARKET VALUE weights from capitalStructure (CFA standard — never book for equity)
   - Sanity: WACC 6-14% for developed markets; explain deviations

4. TERMINAL VALUE (Both Methods Required)
   - Gordon: g = min(long-run nominal GDP ~2.5%, reinvestment × ROIC); MUST be < WACC; default 2.0-2.5%
   - Exit Multiple: peer median EV/EBITDA from competitors; justify deviations
   - Blended implied price weights Exit 60% / Gordon 40%

5. DDM APPLICABILITY (Strict)
   - Requires: yearsOfDividendHistory ≥ 5, payoutRatio 20-80%, regular paymentFrequency
   - If applicable, required_return = CAPM cost of equity
   - Two-stage: short-term from dividendGrowth3yr/5yr, long-term = terminal growth

6. COMPARABLE COMPANY ANALYSIS
   - Use competitors array; EV/EBITDA = enterpriseValue / ebitdaTTM
   - Peer median (not mean); peers ~ same industry, 0.5-2x market cap, similar growth
   - Primary multiple EV/EBITDA (capital-structure neutral); secondary P/E
   - Note any premium/discount vs peers with reason

7. SCENARIO ANALYSIS (Event-Driven)
   - BEAR: name specific downside (e.g., "commodity decline", "regulatory headwind"); quantify impact on growth, margin, multiple
   - BASE: matches your DCF base case
   - BULL: name specific upside catalyst; quantify impact on each driver
   - Each driver needs a rationale — not just "bear = lower"

8. INVESTMENT THESIS (3 sentences max)
   - (1) Business & competitive position (2) Valuation view with approximate % upside/downside (3) Key catalyst or risk

9. KEY RISKS (3-5 specific, not generic)
   - Good: "Gold price < $1,800/oz compresses margins 800bps"
   - Bad: "Economic downturn could hurt revenue"

10. CROSS-VALIDATION (silent; adjust if failed)
    - DCF implied price within ±30% of analystTargetMean?
    - Terminal value < 75% of enterprise value?
    - Implied forward P/E reasonable vs peer median?

CONFIDENCE TAGGING:
- high: directly from provided data / consensus (e.g., FRED risk-free rate, regression beta)
- medium: extrapolated from trends or industry benchmarks
- low: estimated with limited data — flag for user review

DECIMAL FORM: All rates in decimal (0.08 = 8%). Provided FRED yields, dividend yields, margins,
and growth rates are ALREADY decimal (riskFreeRate10yr: 0.0406 = 4.06%). Do NOT re-divide.

SOURCE CITATIONS (non-negotiable):
Every SourcedAssumption `source` must be specific, real, verifiable. Acceptable examples:
"Federal Reserve H.15, April 2026 (10Y)", "Damodaran 2024 implied ERP", "Bloomberg consensus
{ticker} FY2026 revenue", "{ticker} 10-K FY2024 Item 7 MD&A", "Q3 2025 earnings call transcript",
"S&P Capital IQ peer median EV/EBITDA, 2026-04", "Provided data: capitalStructure.debtToCapitalMarket".

FORBIDDEN (vague/generic): "industry standard", "common assumption", "typical value",
"assumed", "default", "analyst estimate" (no firm), "best guess", "reasonable estimate",
"conservative assumption", empty strings.

If no specific source is available: either OMIT the field if the schema allows (nullable DDM fields),
or use EXACTLY "UNVERIFIED — needs manual review" with confidence "low" and a rationale describing
what would be needed. Scan every source before submitting.

11. 3-STATEMENT FORECAST (Required)
    Provide 5-year revenue_forecasts (ABSOLUTE values, same units as revenueLatest),
    ebit_margins and ebitda_margins (decimals), and effective_tax_rate.
    DCF revenue_growth_rates must be CONSISTENT with forecasts (growth = next/prior − 1).
    account_overrides: only override Python-computed items (capex_pct_revenue, dso_days, etc.)
    when you have specific information the historical pattern won't hold.

12. VALUATION CONFIG & BLEND WEIGHTS
    - terminal_value_method: "blended" default; "gordon" if high confidence in g; "exit" for
      real estate / banking where transaction multiples are more reliable
    - cash_flow_basis: "fcff" default; "fcfe" for financial institutions
    - discounting_convention: "end" default; "mid" only if very seasonal or CFA L-II precision desired
    - model_weights:
      * Stable dividend payer (DDM applicable): dcf 0.40, comps 0.30, ddm 0.30
      * Growth name (no dividend): dcf 0.60, comps 0.40, ddm 0.00
      * Mature with modest dividend: dcf 0.50, comps 0.30, ddm 0.20
      * Reduce comps weight if peer data is weak
    - dcf_sub_weights: default blended=1.0 unless you have reason to favor a specific method
    - Explain in weights_rationale

13. SELF-REVIEW (performed after set_valuation_assumptions is called)
    You'll receive a self-review prompt. Verify:
    a) MARGIN CONSISTENCY: EBIT ≈ 1 − COGS% − R&D% − SG&A% (modest leverage room).
       If R&D% + SG&A% alone exceed 1 − EBIT, COGS would be negative — revise EBIT down.
    b) MARGIN TRAJECTORY: Each year steps logically from base; >500bps YoY jumps need explicit catalyst.
    c) REVENUE SANITY: Y1-2 within ±20% of consensus (explain deviations); Y3-5 fade to industry LT growth.
    d) WACC BOUNDS: 6-14% developed markets — flag if outside.
    e) TERMINAL VALUE SHARE: TV < 75% of EV — if higher, near-term FCFs too low; revisit margins/growth.
    If any check fails, re-call set_valuation_assumptions with corrected values."""

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
                    "source": {
                        "type": "string",
                        "minLength": 1,
                        "description": (
                            "REQUIRED. A specific, real, verifiable citation for the value — e.g. "
                            "'Damodaran 2024 implied ERP', 'Federal Reserve H.15 release, April 2026', "
                            "'Bloomberg consensus estimate', 'Q3 2025 earnings call transcript', "
                            "'{ticker} 10-K FY2024'. Vague placeholders like 'industry standard', "
                            "'common assumption', 'typical value', 'assumed', 'default', 'reasonable "
                            "estimate', or empty strings are FORBIDDEN. If you cannot find a specific "
                            "real source, use EXACTLY 'UNVERIFIED — needs manual review' and set "
                            "confidence to 'low'."
                        ),
                    },
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
        max_tokens=3000,
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
