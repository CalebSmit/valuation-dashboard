# AI Stock Valuation Dashboard

An AI-powered equity valuation tool that fetches live financial data and produces institutional-quality DCF, DDM, and comparable company analysis with cited assumptions.

**Live app:** [https://valuation-dashboard-f2f.pages.dev](https://valuation-dashboard-f2f.pages.dev)

---

## What It Does

1. Enter any US ticker symbol and click **ANALYZE**
2. The backend fetches live data from yfinance, FRED, and Damodaran's datasets
3. Claude AI generates defensible valuation assumptions with citations
4. The dashboard computes DCF, DDM, and comps valuations — entirely in your browser
5. Override any assumption and see the model recalculate instantly (<50 ms)
6. Export results to Excel or PDF

## How to Use

1. Open [https://valuation-dashboard-f2f.pages.dev](https://valuation-dashboard-f2f.pages.dev)
2. On first use, click **Settings** and enter your Anthropic API key
3. Type a ticker (e.g., `AAPL`, `MSFT`, `NVDA`) and click **ANALYZE**
4. Wait 30–90 seconds for the AI agent to complete
5. Explore the Overview, DCF, Comps, DDM, Scenarios, and CFA Review tabs

> **Note:** The backend runs on Render's free tier and sleeps after 15 minutes of inactivity.
> If the app shows "Connecting to server…" on first load, wait about 30 seconds for it to wake up.

## What You Need

| Requirement | Details |
|-------------|---------|
| **Anthropic API key** | Required — enter it in Settings on first use. Each run costs ~$0.01–0.15 depending on mode. |
| **A browser** | Chrome, Firefox, Safari, or Edge — no installation required |
| FRED API key | Optional — FRED economic data is fetched from the public endpoint without a key |
| Perplexity / Gemini key | Optional — only needed if you change the AI provider in Settings |

## Features

- **DCF Valuation** — WACC build-up, 5-year FCF projections, sensitivity analysis
- **Dividend Discount Model** — applicability check, single and two-stage pricing
- **Comparable Company Analysis** — AI-selected peers, EV/EBITDA and P/E multiples
- **Bear / Base / Bull Scenarios** — explicit assumption drivers per scenario
- **Football Field Chart** — all methods vs current price at a glance
- **Editable Assumptions** — override any field and recalculate instantly
- **CFA Review** — AI-graded investment committee readiness check
- **Excel & PDF Export** — one-click download of the full model
- **Run History** — saved locally in your browser (no account required)
- **Standard and Deep Research modes** — trade off cost vs. thoroughness

## Architecture

```
Cloudflare Pages (frontend)          Render (backend)
┌────────────────────────────┐       ┌──────────────────────────────┐
│  React 19 + Vite + Tailwind│  ───► │  FastAPI + Python 3.12       │
│  All valuation math runs   │       │  yfinance · FRED · Damodaran │
│  in the browser (TypeScript│       │  Claude / Perplexity / Gemini│
└────────────────────────────┘       └──────────────────────────────┘
```

- **Frontend** — static SPA deployed to Cloudflare Pages. Valuation engines (DCF, DDM, Comps, Scenarios) run entirely in TypeScript in the browser.
- **Backend** — FastAPI on Render. Fetches live financial data, runs the AI agent, and caches results.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for full environment variable reference and hosting instructions.

**Required backend environment variables:**

| Variable | Description |
|----------|-------------|
| `VALUATION_DASHBOARD_ALLOWED_ORIGINS` | Your Cloudflare Pages URL, e.g. `https://valuation-dashboard-f2f.pages.dev` |
| `ANTHROPIC_API_KEY` | Recommended — allows server-side AI analysis without users providing their own key |

**Required frontend build variable (Cloudflare Pages):**

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://valuation-dashboard-api.onrender.com` |

## Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

## Running Tests

```bash
cd frontend
npm run test   # Vitest unit tests
npm run build  # TypeScript check + production build
```

## Project Structure

```
valuation-dashboard/
├── backend/                  # FastAPI (Python) — data fetching + AI agent
│   ├── main.py               # App entry point and health endpoint
│   ├── routers/              # API endpoints (pipeline, financials, analyze, etc.)
│   ├── services/             # yfinance pipeline, AI agent, financial summarizer
│   └── models/               # Pydantic request/response models
├── frontend/                 # React + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── components/       # UI components
│   │   ├── services/         # DCF, DDM, Comps, Scenario engines + API client
│   │   ├── hooks/            # React state management hooks
│   │   ├── types/            # TypeScript interfaces
│   │   └── utils/            # Financial math, formatters, validators
│   └── tests/                # Vitest test suite
└── README.md                 # This file
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Connecting to server…" banner | Backend is waking up (Render free tier). Wait ~30 seconds. |
| "Ticker not found or no data available" | Check the ticker is a valid US equity listed on a major exchange |
| "Invalid API key — check your key in Settings" | Open Settings and re-enter your Anthropic API key |
| "Backend is waking up, please wait 30 seconds" | Render cold start — the backend will respond shortly |
| Pipeline runs more than 10 minutes | Ticker data may be unavailable; try again or use a different ticker |
