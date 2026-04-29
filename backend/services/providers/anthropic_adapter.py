"""Anthropic (Claude) provider adapter.

Uses asyncio.to_thread to run synchronous Anthropic SDK calls off the
event loop, preventing SSE stream stalls during long API calls.

Model routing:
- Standard mode: claude-haiku-4-5-20251001 (fast, cheap, very high rate limits)
- Deep research mode: claude-sonnet-4-20250514 (multi-turn web search, higher quality)
- Self-review: claude-haiku-4-5-20251001 (always, cost-efficient consistency check)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import anthropic

logger = logging.getLogger(__name__)

# Model constants — change here to affect all standard / deep-research calls
MODEL_STANDARD = "claude-haiku-4-5-20251001"      # Fast, high rate limits, low cost
MODEL_DEEP_RESEARCH = "claude-sonnet-4-20250514"  # Multi-turn web search, better citations
MODEL_SELF_REVIEW = "claude-haiku-4-5-20251001"   # Always Haiku — review is deterministic

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


def _slim_summary(summary: dict[str, Any]) -> dict[str, Any]:
    """Remove fields not needed by Claude for assumption generation.

    Strips stockPriceHistory (chart data only), periodReturns and riskMetrics
    (not used in DCF/WACC calculations), and trims businessSummary to 600 chars
    (enough to identify the company). Also collapses the yieldCurve to 4 key
    tenors — Claude only uses the 10yr for the risk-free rate.

    Combined with the max_chars cap, this saves ~1,500–2,000 input tokens per
    standard-mode request without losing any data Claude actually references.
    """
    EXCLUDE_KEYS = {
        "stockPriceHistory",  # Chart data — Claude never references this
        "periodReturns",      # Historical return performance — not used in assumption gen
        "riskMetrics",        # Sharpe/Sortino/Treynor — not used in DCF or WACC
    }
    slimmed = {k: v for k, v in summary.items() if k not in EXCLUDE_KEYS}

    # Trim businessSummary — 600 chars is enough to identify the business; 1500 is wasteful
    if isinstance(slimmed.get("businessSummary"), str):
        slimmed["businessSummary"] = slimmed["businessSummary"][:600]

    # Keep only the key yield curve tenors; Claude uses 10yr for risk-free rate
    if isinstance(slimmed.get("yieldCurve"), dict):
        yc = slimmed["yieldCurve"]
        slimmed["yieldCurve"] = {
            "2yr": yc.get("2yr"),
            "5yr": yc.get("5yr"),
            "10yr": yc.get("10yr"),
            "30yr": yc.get("30yr"),
        }

    return slimmed


def _summary_json(summary: dict[str, Any], max_chars: int) -> str:
    """Serialize and cap financial summary size for Anthropic token limits."""
    compact_summary = _trim_large_fields(_slim_summary(summary))
    serialized = json.dumps(compact_summary, indent=2, default=str)
    if len(serialized) <= max_chars:
        return serialized
    clipped = serialized[:max_chars]
    return f"{clipped}\n... [truncated for token safety]"


def _format_rate_limit_error(error: Exception) -> str:
    """Return a user-friendly Anthropic rate limit message.

    Logs the underlying detail so we can diagnose which bucket tripped
    (ITPM, OTPM, RPM, or overload) without exposing it to the user.
    """
    raw = str(error) if error else ""
    logger.warning("[ANTHROPIC RATE LIMIT] %s", raw)
    return (
        "Too Many Requests. Rate limited. "
        "Anthropic's API is temporarily over capacity. "
        "Wait 60-90 seconds and try again."
    )


def _retry_after_seconds(error: Exception, default: float = 5.0) -> float:
    """Pull a Retry-After hint from an Anthropic RateLimitError, if present."""
    response = getattr(error, "response", None)
    if response is not None:
        headers = getattr(response, "headers", None)
        if headers is not None:
            for key in ("retry-after", "Retry-After"):
                value = headers.get(key) if hasattr(headers, "get") else None
                if value:
                    try:
                        return float(value)
                    except (TypeError, ValueError):
                        pass
    return default


def _create_with_rate_limit_retry(
    client: anthropic.Anthropic,
    on_step: Any = None,
    label: str = "Claude",
    *,
    max_attempts: int = 4,
    cap_seconds: float = 35.0,
    **create_kwargs: Any,
) -> Any:
    """Call client.messages.create with bounded retry on RateLimitError.

    Anthropic 429s are nearly always transient — input-tokens-per-minute
    or requests-per-minute buckets that refill within 30 seconds. The
    SSE connection is kept alive separately by the analyze.py keepalive
    loop, so a 30s wait inside this thread is safe.

    We retry up to 4 times with exponential backoff, honoring the
    server-supplied Retry-After header when present. On final failure
    we re-raise RateLimitError so the caller's existing handler runs.
    """
    last_error: anthropic.RateLimitError | None = None
    for attempt in range(max_attempts):
        try:
            return client.messages.create(**create_kwargs)
        except anthropic.RateLimitError as exc:
            last_error = exc
            if attempt == max_attempts - 1:
                break
            wait = min(_retry_after_seconds(exc, default=4.0 * (2 ** attempt)), cap_seconds)
            logger.warning(
                "[ANTHROPIC RETRY] %s rate-limited (attempt %d/%d), waiting %.1fs",
                label, attempt + 1, max_attempts, wait,
            )
            if on_step:
                on_step(f"{label} is busy — waiting {int(wait)}s and retrying…")
            time.sleep(wait)
    assert last_error is not None
    raise last_error


def _format_auth_error(error: Exception) -> str:
    """Return a user-friendly Anthropic authentication error message."""
    return (
        "Invalid API key for Anthropic. "
        "Check that your ANTHROPIC_API_KEY is correct and active at console.anthropic.com."
    )


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

        try:
            response = _create_with_rate_limit_retry(
                client,
                on_step=on_step,
                label="Claude self-review",
                max_attempts=3,
                model=MODEL_SELF_REVIEW,
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
        except anthropic.AuthenticationError as e:
            raise ValueError(_format_auth_error(e)) from e
        except anthropic.RateLimitError as e:
            # Self-review is a quality enhancement, not a hard requirement.
            # If the second Haiku call after the assumption-generation
            # call gets rate-limited, fall back to the original initial
            # assumptions instead of failing the whole run. The user
            # still gets a complete valuation; we just skip the
            # consistency check.
            logger.warning("[ANTHROPIC SELF-REVIEW SKIPPED] rate-limited: %s", e)
            if on_step:
                on_step("Self-review skipped (rate limit) — using initial assumptions")
            return initial

        _REQUIRED = {"dcf", "wacc", "ddm", "comps", "scenarios", "forecast", "investment_thesis", "key_risks"}

        def _has_meaningful_narrative(rev: dict[str, Any]) -> bool:
            """Reject revisions where the model dropped thesis/risks to fit
            tokens. Better to keep the original (which had them) than promote
            a revision that nukes the user-visible narrative."""
            thesis = rev.get("investment_thesis")
            risks = rev.get("key_risks")
            thesis_ok = isinstance(thesis, str) and len(thesis.strip()) >= 40
            risks_ok = isinstance(risks, list) and len(risks) >= 1 and any(
                isinstance(r, str) and r.strip() for r in risks
            )
            return thesis_ok and risks_ok

        for block in response.content:
            if hasattr(block, "type") and block.type == "tool_use" and block.name == "set_valuation_assumptions":
                revised = dict(block.input)
                # Accept the revision only if (a) all required top-level
                # keys are present and (b) the narrative fields actually
                # have content. Otherwise keep the original which already
                # passed the same check at generation time.
                if _REQUIRED.issubset(revised.keys()) and _has_meaningful_narrative(revised):
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
            # Reduced from 18000 → 12000 chars (~3000 tokens saved per request)
            summary_json = _summary_json(summary, max_chars=12000)

            if on_step:
                on_step("Sending financial data to Claude (Haiku)...")

            messages: list[dict[str, Any]] = [{
                "role": "user",
                "content": f"Generate complete CFA-grade valuation assumptions for {ticker}.\n\nFinancial Data Summary:\n{summary_json}{PEER_SELECTION_INSTRUCTION}",
            }]

            try:
                response = _create_with_rate_limit_retry(
                    client,
                    on_step=on_step,
                    label="Claude (Haiku)",
                    model=MODEL_STANDARD,  # Haiku: high rate limits, much cheaper than Sonnet
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
            logger.info(
                "[ANTHROPIC STANDARD] ticker=%s model=%s input_tokens=%d output_tokens=%d",
                ticker, MODEL_STANDARD, input_tokens, output_tokens,
            )

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
                    response = _create_with_rate_limit_retry(
                        client,
                        on_step=on_step,
                        label=f"Claude Sonnet (deep research turn {turn + 1})",
                        max_attempts=3,
                        model=MODEL_DEEP_RESEARCH,
                        max_tokens=5000,
                        system=full_system,
                        messages=messages,
                        tools=[web_search_tool, ASSUMPTIONS_TOOL],
                        tool_choice={"type": "any"},
                    )
                except anthropic.AuthenticationError as e:
                    raise ValueError(_format_auth_error(e)) from e
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
                        logger.info(
                            "[ANTHROPIC DEEP_RESEARCH] ticker=%s model=%s cum_input_tokens=%d cum_output_tokens=%d turns=%d",
                            ticker, MODEL_DEEP_RESEARCH, cum_input_tokens, cum_output_tokens, turn + 1,
                        )
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
