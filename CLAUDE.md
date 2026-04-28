# CLAUDE.md — AI Stock Valuation Dashboard

This file is read by Claude Code at the start of every session. Follow all instructions here before making any changes.

---

## Repository

**GitHub**: `https://github.com/CalebSmit/valuation-dashboard`
**Default branch**: `master`

### Pull before every session

Always pull the latest code before making any changes:

```bash
git pull origin master
```

If there are merge conflicts, resolve them manually — do not force-push or reset.

### Commit and push after every session

After completing any set of changes:

1. Stage all modified files:
   ```bash
   git add -A
   ```

2. Write a conventional commit message:
   ```
   feat: <short description>        # new feature or capability
   fix: <short description>         # bug fix
   refactor: <short description>    # code change with no behavior change
   chore: <short description>       # tooling, deps, config
   ```

3. Include a brief body listing what changed (files + summary). Example:
   ```
   feat: add collapsible calc breakdown to result cards

   - Added CalcBreakdown component showing formula with actual values
   - Wired into DCFTab, DDMTab, CompsTab result cards
   - Passes tsc --noEmit and all 49 vitest tests
   ```

4. Push:
   ```bash
   git push origin master
   ```

Never commit directly to a feature branch unless specifically asked. Default to `master`.

---

## Project Overview

Full-stack AI-powered equity valuation dashboard. Users enter a stock ticker; the system:

1. Runs a data pipeline that fetches 59 sheets of financial data into `raw_data.xlsx`
2. Sends a compact financial summary to an AI agent (Claude) to generate CFA-grade valuation assumptions
3. Runs DCF, DDM, Comps, and Scenario engines entirely in the browser (TypeScript)
4. Displays interactive results with editable assumptions and instant recalculation

**Tech stack:**
| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.x, Vite 8, Tailwind CSS 4 |
| Backend | Python 3.11+, FastAPI, Uvicorn |
| AI | Anthropic Claude API (primary), Gemini, Perplexity (optional) |
| Local storage | IndexedDB via Dexie 4 |
| Charts | Recharts 3 |
| Export | SheetJS (xlsx), jsPDF, html2canvas |
| Tests | Vitest 4 |

---

## Directory Structure

```
valuation-dashboard/
├── backend/
│   ├── main.py                   FastAPI app entry point
│   ├── config.py                 Path resolution, env vars, port config
│   ├── requirements.txt
│   ├── routers/
│   │   ├── pipeline.py           POST /api/pipeline/{ticker}
│   │   ├── analyze.py            POST /api/analyze/{ticker}  (AI agent)
│   │   ├── peers.py              GET  /api/peers?tickers=...
│   │   ├── financials.py         GET  /api/financials/summary
│   │   ├── sheets.py             GET  /api/sheets
│   │   └── critique.py           POST /api/critique
│   └── services/
│       ├── agent.py              CFA-grade system prompt + tool schema
│       ├── pipeline_runner.py    Subprocess mgmt for py main.py
│       ├── peer_fetcher.py       yfinance peer data
│       ├── excel_reader.py       raw_data.xlsx reader (cached)
│       ├── financial_summarizer.py
│       ├── critique_engine.py
│       └── providers/
│           ├── anthropic_adapter.py
│           ├── gemini_adapter.py
│           └── perplexity_adapter.py
├── frontend/
│   ├── package.json
│   ├── vite.config.ts            Proxies /api → localhost:8000 in dev
│   ├── tsconfig.app.json         Strict mode, bundler resolution, .ts extensions required
│   ├── src/
│   │   ├── App.tsx               Root layout, tab routing, global state
│   │   ├── components/           All UI components (see below)
│   │   ├── services/             Calculation engines + API calls
│   │   ├── hooks/                React hooks (state, overrides, history)
│   │   ├── types/                TypeScript interfaces
│   │   └── utils/                Math, formatters, validators, constants
│   └── tests/                    Vitest test suite (49 tests across 5 files)
├── CLAUDE.md                     This file
├── README.md
├── DASHBOARD_OVERVIEW.md
├── DEPLOYMENT.md
└── QUICKSTART.md
```

---

## Key Components

| Component | What it does |
|-----------|-------------|
| `AssumptionField.tsx` | Editable assumption input with source chip, range warning, correction message, and optional plain-English tooltip (hover `?` badge) |
| `UpsideLabel.tsx` | Large color-coded upside/downside % banner relative to current stock price — green for upside, red for downside |
| `CalcBreakdown.tsx` | Collapsible "How this number was calculated" section showing formula with actual values plugged in |
| `DCFTab.tsx` | WACC build-up card, FCF projection table, sensitivity matrix, all DCF assumptions |
| `DDMTab.tsx` | Applicability checklist (4 criteria), dividend projections, DDM implied price |
| `CompsTab.tsx` | Peer multiples table, implied prices by multiple, weighted blend |
| `ScenariosTab.tsx` | Bear/Base/Bull drivers and probability-weighted expected price |
| `FootballField.tsx` | Recharts bar chart showing all valuation methods vs current price |
| `OverviewTab.tsx` | KPI strip, football field, thesis, key risks |
| `OnboardingGuide.tsx` | First-run setup guide with plain-English description and example tickers (AAPL, MSFT, NVDA) |
| `TickerInput.tsx` | Ticker entry with clickable example chips (AAPL, MSFT, NVDA) below the input |
| `WACCBuildupCard.tsx` | Visual WACC decomposition card |
| `ValuationTabs.tsx` | Tab routing; passes `currentPrice`, `assumptions`, `dcfConfig` etc. to each tab |

---

## Key Services (frontend/src/services/)

| File | Purpose |
|------|---------|
| `dcfEngine.ts` | Core DCF: FCFF/FCFE projections, Gordon Growth + Exit Multiple terminal values, WACC, sensitivity matrix |
| `ddmEngine.ts` | Two-stage DDM with 4-criteria applicability check |
| `compsEngine.ts` | Peer median multiples → implied prices with weighting |
| `scenarioEngine.ts` | Bear/Base/Bull full re-run with probability weighting |
| `agentRunner.ts` | SSE stream parser for AI agent endpoint |
| `financialFetcher.ts` | API calls: pipeline, financials summary, peers, health check |
| `blendingEngine.ts` | Weighted blending of DCF/DDM/Comps into a single implied price |
| `database.ts` | IndexedDB (Dexie) — run history persistence |
| `excelExporter.ts` | Multi-sheet XLSX export |
| `pdfExporter.ts` | PDF executive summary export |

---

## Key Types

| File | Key Interfaces |
|------|---------------|
| `Assumptions.ts` | `SourcedAssumption`, `WACCAssumptions`, `DCFAssumptions`, `DDMAssumptions` |
| `ValuationRun.ts` | `ValuationRun` (includes `currentPrice`, `dcfOutput`, `ddmOutput`, `compsOutput`, `previousPrices`) |
| `FinancialData.ts` | `FinancialData` (all company financials fed into engines) |
| `DCFOutput.ts` | `DCFOutput` (projections, terminal values, sensitivity matrix, implied prices) |
| `DDMOutput.ts` | `DDMOutput` (applicabilityCriteria, dpsProjections, implied price) |
| `CompsOutput.ts` | `CompsOutput` (peerTable, medians, impliedPrices, weightedImpliedPrice) |
| `ValuationConfig.ts` | `DCFConfig` (cashFlowBasis, discountingConvention), enums |

---

## TypeScript Rules — Important

The tsconfig enforces **strict mode** with several extra flags:

- `"strict": true` — all strict checks enabled
- `"noUnusedLocals": true` — no unused variables
- `"noUnusedParameters": true` — no unused function params
- `"allowImportingTsExtensions": true` — imports **must** use `.ts`/`.tsx` extensions (e.g. `import { Foo } from './Foo.tsx'`)
- `"verbatimModuleSyntax": true` — use `import type` for type-only imports
- `"erasableSyntaxOnly": true` — no `const enum`, no legacy decorators

**Always add `.tsx` or `.ts` to local import paths.** Omitting the extension will cause a type-check failure.

---

## Development Commands

### Frontend

```bash
cd frontend

# Install dependencies (first time or after package.json changes)
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Type-check only (no emit) — run before committing
npx tsc --noEmit

# Full build (type-check + Vite bundle)
npm run build

# Run all tests (49 tests across 5 files)
npm test

# Lint
npm run lint
```

### Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Start dev server
py -m uvicorn main:app --port 8000 --reload
# or on Unix:
python -m uvicorn main:app --port 8000 --reload
```

### One-Click (Windows)

```bash
# Start both frontend + backend
START_DASHBOARD.bat

# Verify build + tests
VERIFY_DASHBOARD.bat
```

---

## Pre-Commit Checklist

Run these every time before committing:

```bash
cd frontend

# 1. Type-check
npx tsc --noEmit

# 2. Run tests
npm test

# 3. Build (catches any Vite/bundle issues)
npm run build
```

All three must pass with zero errors. Do not commit if any fail.

---

## Environment Variables

Copy `.env.example` to `.env` for local dev. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VALUATION_DASHBOARD_BACKEND_PORT` | `8000` | Backend port |
| `VALUATION_DASHBOARD_BACKEND_HOST` | `127.0.0.1` | Backend host |
| `VALUATION_DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins (comma-separated) |
| `ANTHROPIC_API_KEY` | _(empty)_ | Backend-owned Claude key (optional; user can supply key in UI) |
| `PERPLEXITY_API_KEY` | _(empty)_ | Optional Perplexity Sonar key |
| `GEMINI_API_KEY` | _(empty)_ | Optional Gemini key |
| `VITE_API_BASE_URL` | _(empty)_ | Set for split deploy (e.g. `https://your-api.fly.dev`); leave empty for local |
| `DATA_DIR` | project root | Override path for `raw_data.xlsx` and cache (useful for Docker volumes) |

Frontend env vars (`VITE_*`) are baked into the Vite build at build time.

---

## API Routes

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/api/pipeline/{ticker}` | Runs `py main.py --ticker {ticker}` and streams logs as SSE |
| `GET` | `/api/financials/summary` | Reads `raw_data.xlsx` → returns compact financial summary JSON |
| `POST` | `/api/analyze/{ticker}` | Runs AI agent → returns streaming SSE of assumption generation |
| `GET` | `/api/peers?tickers=MSFT,GOOGL` | Fetches peer financial metrics from yfinance |
| `GET` | `/api/sheets` | Lists sheet names in `raw_data.xlsx` |
| `POST` | `/api/critique` | AI critique of generated assumptions |

In local dev, Vite proxies all `/api` requests to `http://localhost:8000`.

---

## Valuation Model Quick Reference

### DCF
```
UFCF = Revenue × EBITDA_margin × (1 − tax_rate) + D&A − CapEx − ΔNWC
TV (Gordon Growth) = FCF_5 × (1+g) / (WACC − g)
TV (Exit Multiple) = EBITDA_5 × exit_multiple
Implied Price = (EV − Net Debt) / Shares Outstanding
Blended = 40% Gordon + 60% Exit Multiple
```

### WACC
```
Cost of Equity = Rf + β × ERP + size_premium
After-Tax Cost of Debt = kd × (1 − tax_rate)
WACC = (E/V) × ke + (D/V) × kd(1−t)
```

### DDM (Two-Stage)
```
Stage 1: PV of dividends for 5 years at short-term growth
Stage 2: TV = D_5 × (1+g_lt) / (ke − g_lt)
Implied Price = PV(Stage 1) + PV(Stage 2)
```

### Comps
```
Implied EV = peer_median_multiple × subject_metric
Weighted Price = 40% EV/EBITDA + 30% P/E + 20% EV/Sales + 10% P/B
```

---

## Assumption Fields — Tooltips Convention

Every `AssumptionField` that represents a named financial concept should have a `tooltip` prop — one plain-English sentence explaining what the number means and why it matters. The tooltip appears as a `?` badge on hover. Existing tooltips are defined inline in `DCFTab.tsx` and `DDMTab.tsx` as `TOOLTIPS` objects at the top of the file.

When adding new assumption fields, always add a corresponding tooltip entry.

---

## Testing

Tests live in `frontend/tests/` and use Vitest.

| File | What it covers |
|------|---------------|
| `dcfEngine.test.ts` | 8 tests — FCF projection, terminal value, sensitivity matrix |
| `ddmEngine.test.ts` | 9 tests — applicability criteria, two-stage price |
| `compsEngine.test.ts` | 8 tests — peer medians, implied prices, weighting |
| `financialMath.test.ts` | 20 tests — WACC, ROIC, CAPM, formatting helpers |
| `excelExporter.test.ts` | 4 tests — workbook structure and sheet names |

Add tests for any new calculation logic in the relevant test file. Do not add tests for UI components (no DOM testing setup).

---

## Common Pitfalls

1. **Missing `.tsx`/`.ts` on imports** — the tsconfig requires explicit extensions on all local imports. `import { Foo } from './Foo'` will fail; write `import { Foo } from './Foo.tsx'`.

2. **`import type` for type-only imports** — `verbatimModuleSyntax` requires `import type { Foo }` when importing only a type, not a value.

3. **`noUnusedLocals`/`noUnusedParameters`** — remove any variable or param you introduce but don't use, or prefix it with `_`.

4. **`raw_data.xlsx` must exist** — the backend will start without it but every API call requiring financial data will fail. Run `py main.py` (or enter a ticker in the dashboard) to generate it.

5. **Backend CORS** — if the frontend origin is not in `VALUATION_DASHBOARD_ALLOWED_ORIGINS`, all API calls will fail with CORS errors.

6. **`currentPrice` flows through `ValuationRun`** — the `UpsideLabel` component in DCFTab, DDMTab, and CompsTab receives `currentPrice` from `ValuationTabs` via `run.currentPrice`. If you add a new tab with an implied price, wire `currentPrice` the same way.

7. **Assumption override paths** — overrides use dot-notation path strings (e.g. `'wacc.risk_free_rate'`, `'dcf.terminal_growth_rate'`). These are handled in `useAssumptions.ts`. Match the path exactly.

---

## Deployment (Split: Cloudflare Pages + Fly.io)

**Frontend (Cloudflare Pages):**
- Build command: `cd frontend && npm install && npm run build`
- Output directory: `frontend/dist`
- Env var: `VITE_API_BASE_URL=https://your-backend.fly.dev`

**Backend (Fly.io):**
- Dockerfile lives at `backend/Dockerfile`
- Fly config at `backend/fly.toml`
- Required env vars: `ANTHROPIC_API_KEY`, `VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://your-frontend.pages.dev`
- Persistent volume needed for `raw_data.xlsx` (mount at `/data`, set `DATA_DIR=/data`)

See `DEPLOYMENT.md` for full details.
