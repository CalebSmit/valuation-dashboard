"""Perplexity (Sonar) provider adapter.

Uses Perplexity's OpenAI-compatible API with JSON structured output.
Web search is always active (it's a search engine).
Uses asyncio.to_thread to avoid blocking the event loop.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import requests

from services.agent import SYSTEM_PROMPT, ASSUMPTIONS_JSON_SCHEMA, PEER_SELECTION_INSTRUCTION

PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"


class PerplexityAdapter:
    async def generate_assumptions(
        self,
        ticker: str,
        financial_summary: dict[str, Any],
        api_key: str,
        deep_research: bool = False,
        on_step: Any = None,
    ) -> dict[str, Any]:
        def _call() -> dict[str, Any]:
            summary_json = json.dumps(financial_summary, indent=2, default=str)

            system_content = SYSTEM_PROMPT + (
                "\n\nIMPORTANT: Output ONLY valid JSON matching the schema provided. "
                "No markdown, no explanation, just the JSON object."
            )

            user_content = (
                f"Generate complete CFA-grade valuation assumptions for {ticker}.\n\n"
                f"Financial Data Summary:\n{summary_json}\n\n"
                f"Output JSON schema:\n{json.dumps(ASSUMPTIONS_JSON_SCHEMA, indent=2)}"
                f"{PEER_SELECTION_INSTRUCTION}"
            )

            if on_step:
                mode = "Deep Research" if deep_research else "Standard"
                on_step(f"Calling Perplexity Sonar ({mode})...")

            # Perplexity uses OpenAI-compatible API format
            model = "sonar-pro" if deep_research else "sonar"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            body: dict[str, Any] = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": 4000,
                "temperature": 0.1,
            }

            # Deep research gets more recent results
            if deep_research:
                body["search_recency_filter"] = "week"

            response = requests.post(PERPLEXITY_API_URL, headers=headers, json=body, timeout=60)

            if response.status_code != 200:
                raise ValueError(f"Perplexity API error {response.status_code}: {response.text[:200]}")

            result = response.json()
            content = result["choices"][0]["message"]["content"]

            # Extract citations if available
            citations = result.get("citations", [])

            if on_step and citations:
                on_step(f"Found {len(citations)} web citations")

            # Parse JSON from response (may be wrapped in markdown code blocks)
            json_str = content.strip()
            if json_str.startswith("```"):
                # Strip markdown code block
                lines = json_str.split("\n")
                json_str = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

            assumptions = json.loads(json_str)

            # Inject Perplexity citations into sources where possible
            if citations:
                assumptions = _inject_citations(assumptions, citations)

            return assumptions

        return await asyncio.to_thread(_call)


def _inject_citations(assumptions: dict, citations: list[str]) -> dict:
    """Append Perplexity citation URLs to source fields where they reference web data."""
    citation_note = f" [Sources: {', '.join(citations[:3])}]"
    # Add to investment thesis source info
    if "investment_thesis" in assumptions and isinstance(assumptions["investment_thesis"], str):
        assumptions["investment_thesis"] = assumptions["investment_thesis"] + citation_note
    return assumptions
