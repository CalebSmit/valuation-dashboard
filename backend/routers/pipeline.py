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

    def _format(kind: str, data: str) -> str | None:
        if kind == "pipeline":
            return f"data: {json.dumps({'type': 'pipeline', 'message': data})}\n\n"
        if kind == "complete":
            return f"data: {json.dumps({'type': 'pipeline_complete', 'message': data})}\n\n"
        if kind == "error":
            return f"data: {json.dumps({'type': 'error', 'message': data})}\n\n"
        return None

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

        # Poll the queue without blocking the executor pool. If we drain
        # everything, sleep briefly and re-check; emit a keepalive every
        # 15 s of idle time so Render's idle-connection killer stays
        # quiet. This loop only exits after the producer has signalled
        # `done` AND the queue has been drained — fixing a race where the
        # earlier wait_for timeout could exit before flushing a final
        # `complete` message.
        last_keepalive = 0.0
        loop_started = asyncio.get_event_loop().time()
        seen_done = False
        while True:
            drained_any = False
            while True:
                try:
                    kind, data = msg_q.get_nowait()
                except thread_queue.Empty:
                    break
                drained_any = True
                if kind == "done":
                    seen_done = True
                    continue
                rendered = _format(kind, data)
                if rendered is not None:
                    yield rendered

            if seen_done and msg_q.empty():
                break

            now = asyncio.get_event_loop().time()
            if (now - last_keepalive) >= 15.0:
                # Emit a comment-only keepalive so the SSE connection
                # stays warm during long synchronous yfinance calls.
                yield ": keepalive\n\n"
                last_keepalive = now

            if not drained_any:
                await asyncio.sleep(0.25)

            # Defensive: if the producer died without putting `done`
            # (should not happen — there's a finally — but lock down).
            if task.done() and msg_q.empty():
                break

            # Hard cap so a wedged pipeline can't pin a connection forever.
            if (now - loop_started) > 12 * 60:  # 12 min
                yield f"data: {json.dumps({'type': 'error', 'message': 'Pipeline exceeded 12 minute timeout.'})}\n\n"
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
