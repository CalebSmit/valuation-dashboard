"""Pipeline execution endpoint — fetches financial data via yfinance + FRED and streams progress via SSE."""
from __future__ import annotations

import asyncio
import json
import queue as thread_queue

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
        # Use a queue so we can interleave keepalive comments while the
        # sync pipeline runs in a thread — prevents Render / proxies from
        # killing the idle SSE connection during long yfinance fetches.
        msg_q: thread_queue.Queue[tuple[str, str]] = thread_queue.Queue()

        async def _produce() -> None:
            try:
                async for line in run_pipeline(clean, fred_api_key=request.fred_api_key):
                    msg_q.put_nowait(("pipeline", line))
                msg_q.put_nowait(("complete", "Pipeline finished successfully"))
            except PipelineError as e:
                msg_q.put_nowait(("error", str(e)))
            except Exception as e:
                msg_q.put_nowait(("error", f"Unexpected error: {e}"))
            finally:
                msg_q.put_nowait(("done", ""))

        task = asyncio.create_task(_produce())

        while not task.done():
            try:
                kind, data = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None, msg_q.get, True, 15.0
                    ),
                    timeout=16.0,
                )
                if kind == "pipeline":
                    yield f"data: {json.dumps({'type': 'pipeline', 'message': data})}\n\n"
                elif kind == "complete":
                    yield f"data: {json.dumps({'type': 'pipeline_complete', 'message': data})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'type': 'error', 'message': data})}\n\n"
                elif kind == "done":
                    break
            except (asyncio.TimeoutError, thread_queue.Empty):
                # Send keepalive comment — keeps Render / nginx from closing the connection
                yield ": keepalive\n\n"

        # Drain any remaining messages after task completes
        while not msg_q.empty():
            try:
                kind, data = msg_q.get_nowait()
                if kind == "pipeline":
                    yield f"data: {json.dumps({'type': 'pipeline', 'message': data})}\n\n"
                elif kind == "complete":
                    yield f"data: {json.dumps({'type': 'pipeline_complete', 'message': data})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'type': 'error', 'message': data})}\n\n"
            except thread_queue.Empty:
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
