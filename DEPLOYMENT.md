# Valuation Dashboard — Deployment Guide

## Architecture Overview

The dashboard is a **split deployment**:

| Layer | Technology | Recommended Host |
|---|---|---|
| Frontend (SPA) | React 19 + Vite 8 | **Cloudflare Pages** |
| Backend (API) | Python 3.12 + FastAPI | Fly.io / Render / Railway |

Cloudflare Pages serves the static frontend globally from the edge.
The FastAPI backend runs on a traditional host with a persistent filesystem
(needed for `raw_data.xlsx` and the pipeline subprocess).

---

## 1 — Cloudflare Pages (Frontend)

### Build settings (set in Pages dashboard or `wrangler.toml`)

| Setting | Value |
|---|---|
| Framework preset | None (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

### Environment variables (Pages → Settings → Environment Variables)

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://your-backend.fly.dev` | Must point to your deployed backend |

### What's already included for Cloudflare Pages

- `frontend/public/_redirects` — SPA fallback (`/* /index.html 200`)
- `frontend/public/_headers` — immutable cache for hashed assets, no-cache for `index.html`
- `frontend/public/_routes.json` — tells Pages to serve all routes from the SPA

No `wrangler.toml` is needed for a purely static Pages deployment. Connect the
GitHub repo in the Pages dashboard and it will auto-deploy on every push to `master`.

---

## 2 — Backend on Fly.io (Recommended)

### Prerequisites
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login
```

### First-time deploy
```bash
cd backend

# Create the app (choose a unique name)
fly launch --name valuation-dashboard-api --region ord --no-deploy

# Create a 1 GB persistent volume for raw_data.xlsx and cache
fly volumes create raw_data_vol --size 1 --region ord

# Set required secrets
fly secrets set \
  VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://your-project.pages.dev \
  ANTHROPIC_API_KEY=sk-ant-...

# Optional provider keys
fly secrets set PERPLEXITY_API_KEY=pplx-... GEMINI_API_KEY=...

# Deploy
fly deploy
```

### Subsequent deploys
```bash
cd backend && fly deploy
```

### Environment variables (backend)

| Variable | Required | Description |
|---|---|---|
| `VALUATION_DASHBOARD_ALLOWED_ORIGINS` | **Yes** | Comma-separated list of allowed frontend origins, e.g. `https://your-project.pages.dev` |
| `ANTHROPIC_API_KEY` | Recommended | Enables server-side AI analysis (users don't need to provide their own key) |
| `PERPLEXITY_API_KEY` | Optional | Enables Perplexity provider |
| `GEMINI_API_KEY` | Optional | Enables Gemini provider |
| `DATA_DIR` | Optional | Override data directory (default: `/data` when `Dockerfile` sets it) |

---

## 3 — Backend on Render (Alternative)

1. Create a new **Web Service** → connect GitHub repo → set root dir to `backend`
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers`
4. Add a **Disk** mount at `/data` (at least 1 GB)
5. Set environment variables as above

---

## 4 — Local Development (unchanged)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `localhost:8000` automatically.
No `VITE_API_BASE_URL` needed in local dev.

---

## 5 — Environment Variable Reference

### Backend (`.env` / host secrets)

```ini
# Server
VALUATION_DASHBOARD_BACKEND_HOST=0.0.0.0      # use 127.0.0.1 for local-only
VALUATION_DASHBOARD_BACKEND_PORT=8000

# CORS — comma-separated list of frontend origins
# Include both the Pages URL and any preview deployment URLs you want to allow
VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://your-project.pages.dev,https://localhost:5173

# AI provider keys (backend-owned — users won't need to enter their own)
ANTHROPIC_API_KEY=
PERPLEXITY_API_KEY=
GEMINI_API_KEY=

# Data directory override (set automatically by Dockerfile to /data)
DATA_DIR=/data
```

### Frontend (Cloudflare Pages env vars — build-time only)

```ini
# Full URL of the deployed backend (no trailing slash)
VITE_API_BASE_URL=https://your-backend.fly.dev
```

---

## 6 — Cloudflare Compatibility Notes

| Feature | Status | Notes |
|---|---|---|
| Frontend (SPA) on Pages | ✅ Ready | `_redirects`, `_headers`, `_routes.json` all present |
| SSE streaming (analyze + pipeline) | ✅ Ready | `Cache-Control: no-cache`, `X-Accel-Buffering: no` headers set |
| CORS for split deploy | ✅ Ready | Set `VALUATION_DASHBOARD_ALLOWED_ORIGINS` on backend |
| Backend on Workers/Pages Functions | ❌ Not supported | Requires persistent filesystem + subprocess spawning |
| Backend on Fly.io / Render | ✅ Recommended | Dockerfile included in `backend/` |

---

## 7 — Verification Checklist

After deploying both services:

- [ ] `https://your-backend.fly.dev/api/health` returns `{"status":"ok"}`
- [ ] `https://your-project.pages.dev` loads the dashboard UI
- [ ] Entering a ticker and clicking Analyze streams SSE without CORS errors
- [ ] Browser DevTools → Network → EventStream shows SSE events flowing
- [ ] `raw_data_exists: true` in the health response (after first pipeline run)
