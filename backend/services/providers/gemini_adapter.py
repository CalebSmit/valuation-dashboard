"""Google Gemini provider adapter.

Uses the google-genai SDK with function calling for structured output.
Deep research mode enables Google Search grounding.
Uses asyncio.to_thread to avoid blocking the event loop.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from services.agent import SYSTEM_PROMPT, ASSUMPTIONS_JSON_SCHEMA, PEER_SELECTION_INSTRUCTION


class GeminiAdapter:
    async def generate_assumptions(
        self,
        ticker: str,
        financial_summary: dict[str, Any],
        api_key: str,
        deep_research: bool = False,
        on_step: Any = None,
    ) -> dict[str, Any]:
        def _call() -> dict[str, Any]:
            try:
                from google import genai
                from google.genai import types
            except ImportError:
                raise ValueError(
                    "Google GenAI SDK not installed. Run: pip install google-genai"
                )

            client = genai.Client(api_key=api_key)
            summary_json = json.dumps(financial_summary, indent=2, default=str)

            model = "gemini-2.5-flash" if not deep_research else "gemini-2.5-pro"

            if on_step:
                mode = "Deep Research" if deep_research else "Standard"
                on_step(f"Calling Gemini {model} ({mode})...")

            # Build the function declaration from our schema
            assumption_function = types.FunctionDeclaration(
                name="set_valuation_assumptions",
                description="Set all valuation assumptions for DCF, DDM, and comps analysis",
                parameters=_convert_schema_to_gemini(ASSUMPTIONS_JSON_SCHEMA),
            )

            tools = [types.Tool(function_declarations=[assumption_function])]

            # Add Google Search grounding for deep research
            if deep_research:
                tools.append(types.Tool(google_search=types.GoogleSearch()))

            user_content = (
                f"Generate complete CFA-grade valuation assumptions for {ticker}.\n\n"
                f"Financial Data Summary:\n{summary_json}"
                f"{PEER_SELECTION_INSTRUCTION}"
            )

            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                tools=tools,
                temperature=0.1,
            )

            response = client.models.generate_content(
                model=model,
                contents=user_content,
                config=config,
            )

            # Extract function call from response
            for part in response.candidates[0].content.parts:
                if part.function_call and part.function_call.name == "set_valuation_assumptions":
                    if on_step:
                        on_step("Structured assumptions received")
                    # Convert protobuf MapComposite to dict
                    return _proto_to_dict(part.function_call.args)

            # If no function call, try to parse text response as JSON
            text = response.text
            if text:
                json_str = text.strip()
                if json_str.startswith("```"):
                    lines = json_str.split("\n")
                    json_str = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
                return json.loads(json_str)

            raise ValueError("Gemini did not return structured assumptions")

        return await asyncio.to_thread(_call)


def _proto_to_dict(obj: Any) -> Any:
    """Recursively convert protobuf MapComposite/RepeatedComposite to Python dict/list."""
    if hasattr(obj, 'items'):
        return {k: _proto_to_dict(v) for k, v in obj.items()}
    if hasattr(obj, '__iter__') and not isinstance(obj, (str, bytes)):
        return [_proto_to_dict(item) for item in obj]
    return obj


def _convert_schema_to_gemini(schema: dict) -> dict:
    """Convert our JSON Schema to Gemini-compatible format.

    Gemini's function calling accepts a subset of JSON Schema.
    We strip unsupported features like $ref and $defs.
    """
    resolved = _resolve_refs(schema, schema.get("$defs", {}))
    # Remove $defs from top level
    resolved.pop("$defs", None)
    return resolved


def _resolve_refs(node: Any, defs: dict) -> Any:
    """Recursively resolve $ref pointers in JSON Schema."""
    if isinstance(node, dict):
        if "$ref" in node:
            ref_path = node["$ref"].split("/")[-1]
            if ref_path in defs:
                return _resolve_refs(defs[ref_path], defs)
            return {"type": "object"}
        if "oneOf" in node:
            # Gemini doesn't support oneOf — take the first non-null option
            for option in node["oneOf"]:
                resolved = _resolve_refs(option, defs)
                if resolved.get("type") != "null":
                    return resolved
            return {"type": "string"}
        return {k: _resolve_refs(v, defs) for k, v in node.items() if k != "$defs"}
    if isinstance(node, list):
        return [_resolve_refs(item, defs) for item in node]
    return node
