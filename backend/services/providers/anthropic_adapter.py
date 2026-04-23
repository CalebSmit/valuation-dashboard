"""Anthropic (Claude) provider adapter.

Uses asyncio.to_thread to run synchronous Anthropic SDK calls off the
event loop, preventing SSE stream stalls during long API calls.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import anthropic

from services.agent import (
    SYSTEM_PROMPT, DEEP_RESEARCH_ADDENDUM, ASSUMPTIONS_TOOL,
    PEER_SELECTION_INSTRUCTION, _build_self_review_message,
)


def _trim_large_fields(value: Any, max_list_items: int = 20, max_dict_items: int = 40) -> Any:
    """Recursively trim oversized lists/dicts to reduce request token usage."""
    if isinstance(value, list):
        trimmed = [_trim_large_fields(item, max_list_items, max_dict_items) for item in value[:max_list_items]]
        if len(value) > max_list_items:
            trimmed.append({"_truncated_items": len(value) - max_list_items})
        return trimmed

    if isinstance(value, dict):
        items = list(value.items())
        selected = items[:max_dict_items]
        result = {
            key: _trim_large_fields(item, max_list_items, max_dict_items)
            for key, item in selected
        }
        if len(items) > max_dict_items:
            result["_truncated_keys"] = len(items) - max_dict_items
        return result

    return value


def _summary_json(summary: dict[str, Any], max_chars: int) -> str:
    """Serialize and cap financial summary size for Anthropic token limits."""
    compact_summary = _trim_large_fields(summary)
    serialized = json.dumps(compact_summary, indent=2, default=str)
    if len(serialized) <= max_chars:
        return serialized
    clipped = serialized[:max_chars]
    return f"{clipped}\n... [truncated for token safety]"


def _format_rate_limit_error(error: Exception) -> str:
    """Return a user-friendly Anthropic rate limit message."""
    raw = str(error)
    request_id = ""
    marker = "'request_id':"
    if marker in raw:
        request_id = raw.split(marker, 1)[1].split("'", 2)[1]

    base = (
        "Anthropic rate limit reached (429). "
        "This run exceeded organization input-tokens-per-minute capacity. "
        "Wait about 60-90 seconds and retry, or switch provider to Perplexity/Gemini."
    )
    if request_id:
        return f"{base} Request ID: {request_id}"
    return base


def _assistant_text_only(content_blocks: list[Any]) -> str:
    """Extract assistant text content and drop tool_use blocks for next-turn safety.

    Anthropic requires any assistant tool_use blocks to be followed by user
    tool_result blocks. If we carry tool_use blocks into the next request
    without tool_result, the API returns a 400 invalid_request_error.
    """
    text_parts: list[str] = []
    for block in content_blocks:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", "")
            if text:
                text_parts.append(text)

    if text_parts:
        return "\n\n".join(text_parts)
    return "[assistant continued reasoning]"


class AnthropicAdapter:
    async def generate_assumptions(
        self,
        ticker: str,
        financial_summary: dict[str, Any],
        api_key: str,
        deep_research: bool = False,
        on_step: Any = None,
        historical_ratios: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if deep_research:
            return await self._deep_research(ticker, financial_summary, api_key, on_step, historical_ratios)
        return await self._standard(ticker, financial_summary, api_key, on_step, historical_ratios)

    def _sync_self_review(
        self,
        client: anthropic.Anthropic,
        system: str,
        messages: list[dict[str, Any]],
        initial: dict[str, Any],
        historical_ratios: dict[str, Any],
        extra_tools: list[dict[str, Any]],
        on_step: Any,
    ) -> dict[str, Any]:
        """Synchronous self-review using Haiku with minimal context for cost efficiency.

        Uses a fresh conversation (not the full history) to avoid re-sending the
        entire 18K financial summary. The full initial assumptions JSON is included
        so the model has every field available for corrections.
        """
        if on_step:
            on_step("Running self-review of forecast assumptions...")

        # Include full assumptions JSON so Haiku can reproduce any field in the tool call
        full_assumptions_json = json.dumps(initial, indent=2, default=str)
        review_content = (
            f"Here are the submitted valuation assumptions:\n\n"
            f"```json\n{full_assumptions_json}\n```\n\n"
            f"{_build_self_review_message(initial, historical_ratios)}"
        )

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=(
                "You are reviewing submitted equity valuation assumptions for mathematical consistency. "
                "Check each criterion provided and call set_valuation_assumptions with the final values — "
                "keep all values that pass unchanged, correct only those that fail."
            ),
            messages=[{"role": "user", "content": review_content}],
            tools=[ASSUMPTIONS_TOOL],
            tool_choice={"type": "any"},
        )

        _REQUIRED = {"dcf", "wacc", "ddm", "comps", "scenarios", "forecast", "investment_thesis", "key_risks"}

        for block in response.content:
            if hasattr(block, "type") and block.type == "tool_use" and block.name == "set_valuation_assumptions":
                revised = dict(block.input)
                # Only accept the Haiku result if it contains all required top-level fields.
                # If it's truncated/incomplete (token limit), fall back to the original Sonnet result.
                if _REQUIRED.issubset(revised.keys()):
                    if on_step:
                        on_step("Self-review found issues — assumptions revised")
                    return revised
                else:
                    if on_step:
                        on_step("Self-review response incomplete — keeping original assumptions")
                    return initial

        if on_step:
            on_step("Self-review passed — no revisions needed")
        return initial

    async def _standard(
        self,
        ticker: str,
        summary: dict[str, Any],
        api_key: str,
        on_step: Any = None,
        historical_ratios: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _call() -> dict[str, Any]:
            client = anthropic.Anthropic(api_key=api_key)
            summary_json = _summary_json(summary, max_chars=18000)

            if on_step:
                on_step("Sending financial data to Claude...")

            messages: list[dict[str, Any]] = [{
                "role": "user",
                "content": f"Generate complete CFA-grade valuation assumptions for {ticker}.\n\nFinancial Data Summary:\n{summary_json}{PEER_SELECTION_INSTRUCTION}",
            }]

            try:
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=3000,
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    tools=[ASSUMPTIONS_TOOL],
                    tool_choice={"type": "tool", "name": "set_valuation_assumptions"},
                )
            except anthropic.RateLimitError as e:
                raise ValueError(_format_rate_limit_error(e)) from e

            input_tokens = getattr(response.usage, "input_tokens", 0) if getattr(response, "usage", None) else 0
            output_tokens = getattr(response.usage, "output_tokens", 0) if getattr(response, "usage", None) else 0

            for block in response.content:
                if block.type == "tool_use" and block.name == "set_valuation_assumptions":
                    if on_step:
                        on_step("Structured assumptions received")
                    initial = dict(block.input)
                    if historical_ratios:
                        messages.append({"role": "assistant", "content": _assistant_text_only(response.content)})
                        reviewed = self._sync_self_review(client, SYSTEM_PROMPT, messages, initial, historical_ratios, [], on_step)
                        reviewed["_usage"] = {
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                        }
                        return reviewed
                    initial["_usage"] = {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                    }
                    return initial

            raise ValueError("Claude did not return structured assumptions")

        return await asyncio.to_thread(_call)

    async def _deep_research(
        self,
        ticker: str,
        summary: dict[str, Any],
        api_key: str,
        on_step: Any,
        historical_ratios: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _call() -> dict[str, Any]:
            from datetime import date
            client = anthropic.Anthropic(api_key=api_key)
            summary_json = _summary_json(summary, max_chars=14000)

            current_year = str(date.today().year)
            industry = summary.get("industry", "")

            full_system = SYSTEM_PROMPT + DEEP_RESEARCH_ADDENDUM.replace(
                "{ticker}", ticker
            ).replace("{current_year}", current_year).replace("{industry}", industry)

            user_message = (
                f"Generate complete CFA-grade valuation assumptions for {ticker}.\n"
                f"Use the web_search tool to validate key assumptions with real citations.\n\n"
                f"Financial Data Summary:\n{summary_json}"
                f"{PEER_SELECTION_INSTRUCTION}"
            )

            web_search_tool = {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 3,
            }

            if on_step:
                on_step("Starting deep research with web search...")

            messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]
            cum_input_tokens = 0
            cum_output_tokens = 0

            for turn in range(4):
                if on_step and turn > 0:
                    on_step(f"Research turn {turn + 1}...")

                try:
                    response = client.messages.create(
                        model="claude-sonnet-4-20250514",
                        max_tokens=5000,
                        system=full_system,
                        messages=messages,
                        tools=[web_search_tool, ASSUMPTIONS_TOOL],
                        tool_choice={"type": "any"},
                    )
                except anthropic.RateLimitError as e:
                    raise ValueError(_format_rate_limit_error(e)) from e

                if getattr(response, "usage", None):
                    cum_input_tokens += getattr(response.usage, "input_tokens", 0) or 0
                    cum_output_tokens += getattr(response.usage, "output_tokens", 0) or 0

                for block in response.content:
                    if hasattr(block, 'type') and block.type == "tool_use" and block.name == "set_valuation_assumptions":
                        if on_step:
                            on_step("Assumptions set with web-sourced citations")
                        initial = dict(block.input)
                        if historical_ratios:
                            messages.append({"role": "assistant", "content": _assistant_text_only(response.content)})
                            reviewed = self._sync_self_review(client, full_system, messages, initial, historical_ratios, [web_search_tool], on_step)
                            reviewed["_usage"] = {
                                "input_tokens": cum_input_tokens,
                                "output_tokens": cum_output_tokens,
                            }
                            return reviewed
                        initial["_usage"] = {
                            "input_tokens": cum_input_tokens,
                            "output_tokens": cum_output_tokens,
                        }
                        return initial

                for block in response.content:
                    if hasattr(block, 'type') and block.type == "web_search_tool_result":
                        if on_step:
                            on_step("Web search completed")

                messages.append({"role": "assistant", "content": _assistant_text_only(response.content)})
                messages.append({
                    "role": "user",
                    "content": "Now call the set_valuation_assumptions tool with your final assumptions.",
                })

            raise ValueError("Claude deep research did not produce assumptions within turn limit")

        return await asyncio.to_thread(_call)
