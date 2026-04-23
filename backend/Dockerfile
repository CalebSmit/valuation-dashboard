# ── Valuation Dashboard Backend ───────────────────────────────────────────────
# Python 3.12 slim image for Fly.io / Render / Railway deployment.
#
# Build:   docker build -t valuation-dashboard-api ./backend
# Run:     docker run -p 8000:8000 \
#            -e ANTHROPIC_API_KEY=sk-ant-... \
#            -e VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://your-project.pages.dev \
#            valuation-dashboard-api
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim

# Install system deps required by some Python packages (openpyxl, pandas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Data directory — mount a persistent volume here on Fly.io to persist raw_data.xlsx
# e.g. fly volumes create raw_data_vol --size 1 --region ord
# and in fly.toml: [[mounts]] source="raw_data_vol" destination="/data"
RUN mkdir -p /data

# Tell the app to look for raw_data.xlsx in /data when DATA_DIR env var is set.
# Falls back to project root if not set (local dev).
ENV DATA_DIR=/data

EXPOSE 8000

# Uvicorn — bind to 0.0.0.0 so the container port is reachable
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
