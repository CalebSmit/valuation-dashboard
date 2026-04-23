from __future__ import annotations

import asyncio
import sys

# asyncio.create_subprocess_exec requires ProactorEventLoop on Windows.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

from config import BACKEND_HOST, DEFAULT_PORT
from main import app


if __name__ == "__main__":
    uvicorn.run(app, host=BACKEND_HOST, port=DEFAULT_PORT)
