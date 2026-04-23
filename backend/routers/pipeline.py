"""Pipeline execution endpoint — runs py main.py and streams output via SSE."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.responses import PipelineRequest
from services.pipeline_runner import run_pipeline, PipelineError
from services.ticker_validation import is_valid_ticker, normalize_ticker

router = APIRouter(tags=["pipeline"])


@router.post("/pipeline/{ticker}")
async def execute_pipeline(ticker: str, request: PipelineRequest = PipelineRequest()):
    clean = normalize_ticker(ticker)
    if not is_valid_ticker(clean):
        raise HTTPException(status_code=400, detail="Invalid ticker format")

    async def event_stream():
        try:
            async for line in run_pipeline(clean, fred_api_key=request.fred_api_key):
                yield f"data: {json.dumps({'type': 'pipeline', 'message': line})}\n\n"
            yield f"data: {json.dumps({'type': 'pipeline_complete', 'message': 'Pipeline finished successfully'})}\n\n"
        except PipelineError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Unexpected error: {e}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
