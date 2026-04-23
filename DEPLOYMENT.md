# Valuation Dashboard — Deployment Guide

## Live Deployment

| Layer | URL | Host |
|-------|-----|------|
| Frontend (SPA) | https://valuation-dashboard-f2f.pages.dev | Cloudflare Pages |
| Backend (API) | https://valuation-dashboard-api.onrender.com | Render (free tier) |

---

## Architecture Overview

The dashboard is a **split deployment**:

| Layer | Technology | Host |
|-------|------------|------|
| Frontend (SPA) | React 19 + Vite | **Cloudflare Pages** |
| Backend (API) | Python 3.12 + FastAPI | **Render** |

The frontend is a static build served from Cloudflare's edge CDN. All valuation math (DCF, DDM, Comps, Scenarios) runs in TypeScript in the user's browser. The FastAPI backend handles data fetching (yfinance, FRED, Damodaran) and AI agent calls (Claude / Perplexity / Gemini).

> **Free tier note:** Render's free tier sleeps after 15 minutes of inactivity. The frontend shows a "Connecting to server…" banner on cold start and automatically retries until the backend responds (~30 seconds).

---

## 1 — Cloudflare Pages (Frontend)

### Build settings

| Setting | Value |
|---------|-------|
| Framework preset | None (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

### Environment variables

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_API_BASE_URL` | `https://valuation-dashboard-api.onrender.com` | Must point to your deployed backend |

### Included Cloudflare config files

- `frontend/public/_redirects` — SPA fallback (`/* /index.html 200`)
- `frontend/public/_headers` — immutable cache for hashed assets, no-cache for `index.html`
- `frontend/public/_routes.json` — tells Pages to serve all routes from the SPA

The GitHub repo is connected to Cloudflare Pages and auto-deploys on every push to `master`.

---

## 2 — Render (Backend)

### Service settings

| Setting | Value |
|---------|-------|
| Service type | Web Service |
| Root directory | `backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers` |
| Runtime | Python 3.12 |

### Disk (required for data persistence)

Add a **Disk** mount at `/data` (minimum 1 GB). This is where `raw_data.xlsx` and the cache are stored between requests.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VALUATION_DASHBOARD_ALLOWED_ORIGINS` | **Yes** | `https://valuation-dashboard-f2f.pages.dev` |
| `ANTHROPIC_API_KEY` | Recommended | Server-side AI — users won't need to enter their own key |
| `PERPLEXITY_API_KEY` | Optional | Enables Perplexity provider |
| `GEMINI_API_KEY` | Optional | Enables Gemini provider |
| `DATA_DIR` | **Yes** | Set to `/data` (matches the disk mount) |

> **Security:** `ANTHROPIC_API_KEY` is stored as an environment variable and is never echoed in API responses or error messages. The `/api/health` endpoint only returns provider names (not keys).

---

## 3 — Alternative: Fly.io (Backend)

If you prefer Fly.io over Render:

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

cd backend

# Create the app
fly launch --name valuation-dashboard-api --region ord --no-deploy

# Create a persistent volume for raw_data.xlsx and cache
fly volumes create raw_data_vol --size 1 --region ord

# Set required secrets
fly secrets set \
  VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://valuation-dashboard-f2f.pages.dev \
  ANTHROPIC_API_KEY=sk-ant-...

# Deploy
fly deploy
```

---

## 4 — Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

No `VITE_API_BASE_URL` needed locally — Vite proxies `/api` to `localhost:8000` automatically.

---

## 5 — Environment Variable Reference

### Backend (Render / Fly.io / `.env`)

```ini
# CORS — comma-separated list of allowed frontend origins
VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://valuation-dashboard-f2f.pages.dev

# AI provider keys (server-owned — users won't need to enter their own)
ANTHROPIC_API_KEY=sk-ant-...
PERPLEXITY_API_KEY=pplx-...
GEMINI_API_KEY=...

# Data directory (must match disk mount path)
DATA_DIR=/data

# Server (optional overrides)
VALUATION_DASHBOARD_BACKEND_HOST=0.0.0.0
VALUATION_DASHBOARD_BACKEND_PORT=10000
```

### Frontend (Cloudflare Pages — build-time only)

```ini
# Full URL of the deployed backend (no trailing slash)
VITE_API_BASE_URL=https://valuation-dashboard-api.onrender.com
```

---

## 6 — Verification Checklist

After deploying both services:

- [ ] `https://valuation-dashboard-api.onrender.com/api/health` returns `{"status":"ok"}`
- [ ] `https://valuation-dashboard-f2f.pages.dev` loads the dashboard UI
- [ ] The "Connecting to server…" banner appears briefly then disappears
- [ ] Entering a ticker and clicking Analyze streams SSE without CORS errors
- [ ] Browser DevTools → Network → EventStream shows SSE events flowing
- [ ] `raw_data_exists: true` in the health response after a ticker has been analyzed

---

## 7 — Cloudflare Compatibility Notes

| Feature | Status | Notes |
|---------|--------|-------|
| Frontend (SPA) on Pages | ✅ Ready | `_redirects`, `_headers`, `_routes.json` all present |
| SSE streaming (analyze + pipeline) | ✅ Ready | `Cache-Control: no-cache`, `X-Accel-Buffering: no` headers set |
| CORS for split deploy | ✅ Ready | Set `VALUATION_DASHBOARD_ALLOWED_ORIGINS` on backend |
| Backend on Workers/Pages Functions | ❌ Not supported | Requires persistent filesystem + Python runtime |
| Backend on Render / Fly.io | ✅ Supported | Dockerfile included in `backend/` |
