# CLAUDE.md — AI Stock Valuation Dashboard

Read this file at the start of every session. Follow every instruction here before making changes.

> **This file must stay in sync with the codebase.** If you change something that contradicts what's written here (e.g. add a new component, rename a hook, change a deployment URL, swap a host), update this file as part of the same commit. A stale CLAUDE.md is worse than no CLAUDE.md.

---

## 1. GitHub Workflow

**Repository:** `https://github.com/CalebSmit/valuation-dashboard`
**Branch:** `master` (always — never create a feature branch unless explicitly asked)

### Before touching any code

```bash
git pull origin master
```

Resolve any conflicts manually. Never force-push.

### After completing changes

```bash
# 1. Verify nothing is broken first (see section 6)
cd frontend
npx tsc --noEmit
npm test
npm run build

# 2. Stage and commit
cd ..
git add -A
git commit -m "feat|fix|refactor|chore: short description

- What changed (file or component name + one line)
- What changed
- Tests: X/X passed, build: clean"

# 3. Push
git push origin master
```

Commit message types: `feat` (new feature), `fix` (bug fix), `refactor` (no behavior change), `chore` (config/deps/tooling).

**Always commit and push** when you make changes — do not leave local-only edits sitting on disk. Cloudflare Pages auto-deploys on every push to `master`, so a clean commit and push is how changes ship.

---

## 2. Live Deployment

This is a **split deployment** — frontend and backend are hosted separately and talk over HTTPS.

| Layer | URL | Host |
|-------|-----|------|
| Frontend (SPA) | https://valuation-dashboard-f2f.pages.dev | Cloudflare Pages |
| Backend (API) | https://valuation-dashboard-api.onrender.com | Render (free tier) |

**Cloudflare Pages** auto-deploys the frontend on every push to `master`. No manual deploy step needed — just push and it builds.

**Render** hosts the Python/FastAPI backend. It sleeps after 15 min of inactivity on the free tier (~30s cold start). The frontend handles this with a "Connecting to server…" banner that retries automatically.

**CORS:** The Render backend has `VALUATION_DASHBOARD_ALLOWED_ORIGINS=https://valuation-dashboard-f2f.pages.dev` set as a secret env var. The `localhost:5173` default in `.env.example` is only the local dev fallback — it does not affect production.

**Cloudflare Pages build settings:**
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Env var: `VITE_API_BASE_URL=https://valuation-dashboard-api.onrender.com`

**Render build settings:**
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers`
- Disk mounted at `/data` (where `raw_data.xlsx` and cache live)
- Env var: `DATA_DIR=/data`

---

## 3. Architecture

```
Browser (React + TypeScript)
    ↕ /api  (proxied by Vite in dev, direct HTTPS in prod)
FastAPI backend (Python 3.12, Render)
    ↕  yfinance · OpenBB · FRED · Damodaran · Anthropic Claude API
   ↕  raw_data.xlsx  (59 sheets, persisted to Render disk at /data)
```

All four valuation engines (DCF, DDM, Comps, Scenarios) run **entirely in the browser** in TypeScript — no server round-trip needed after the initial data fetch. This is what makes assumption overrides instant.

**Tech stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.x, Vite 8, Tailwind CSS 4 |
| Backend | Python 3.12, FastAPI, Uvicorn |
| AI provider | Anthropic Claude (primary), Gemini, Perplexity (optional) |
| Local storage | IndexedDB via Dexie 4 (run history) |
| Charts | Recharts 3 |
| Export | SheetJS (xlsx), jsPDF, html2canvas |
| Tests | Vitest 4 |

---

## 4. Project Structure

```
valuation-dashboard/
├── backend/
│   ├── main.py                    FastAPI app, CORS, health check, SPA fallback
│   ├── config.py                  Path resolution, env var parsing, CORS origins
│   ├── requirements.txt
│   ├── Dockerfile                 For Render / Fly.io deployment
│   ├── fly.toml                   Fly.io config (alternative to Render)
│   ├── routers/
│   │   ├── pipeline.py            POST /api/pipeline/{ticker}  — runs data pipeline
│   │   ├── analyze.py             POST /api/analyze/{ticker}   — AI agent (SSE stream)
│   │   ├── peers.py               GET  /api/peers?tickers=...  — peer yfinance data
│   │   ├── financials.py          GET  /api/financials/summary — compact summary JSON
│   │   ├── sheets.py              GET  /api/sheets             — list xlsx sheet names
│   │   └── critique.py            POST /api/critique           — AI assumption critique
│   └── services/
│       ├── agent.py               CFA-grade system prompt + tool schema for Claude
│       ├── pipeline_runner.py     Subprocess manager for py main.py
│       ├── peer_fetcher.py        Lightweight yfinance peer data fetcher
│       ├── excel_reader.py        raw_data.xlsx reader (cached)
│       ├── financial_summarizer.py  Extracts compact ~2KB summary from 59 sheets
│       ├── critique_engine.py
│       └── providers/
│           ├── anthropic_adapter.py   Claude (standard + deep research with web search)
│           ├── gemini_adapter.py
│           └── perplexity_adapter.py
├── frontend/
│   ├── package.json
│   ├── vite.config.ts             Proxies /api → localhost:8000 in dev
│   ├── tsconfig.app.json          Strict mode — see section 5
│   ├── src/
│   │   ├── App.tsx                Root layout, tab routing, all top-level state
│   │   ├── components/            All UI components (see section 7)
│   │   ├── services/              Calculation engines + API calls (see section 8)
│   │   ├── hooks/                 React hooks for state management (see section 9)
│   │   ├── types/                 TypeScript interfaces (see section 10)
│   │   └── utils/                 constants.ts, financialMath.ts, formatters.ts, rangeWarnings.ts, validators.ts
│   └── tests/                     Vitest suite — 49 tests across 5 files
├── CLAUDE.md                      This file
├── README.md
├── DASHBOARD_OVERVIEW.md          Full technical walkthrough with AAPL demo run
├── DEPLOYMENT.md                  Step-by-step deployment guide
└── QUICKSTART.md
```

---

## 5. TypeScript Rules — Read Carefully

The `tsconfig.app.json` is strict. These rules bite most often:

### Always use `.tsx` / `.ts` extensions on local imports

`allowImportingTsExtensions: true` is set, which means you **must** include the extension:

```ts
// ✅ correct
import { AssumptionField } from './AssumptionField.tsx'
import type { DCFOutput } from '../types/DCFOutput.ts'

// ❌ will fail tsc
import { AssumptionField } from './AssumptionField'
```

### Use `import type` for type-only imports

`verbatimModuleSyntax: true` requires this:

```ts
// ✅ correct
import type { DCFOutput } from '../types/DCFOutput.ts'

// ❌ will fail if Foo is only a type
import { Foo } from '../types/Foo.ts'
```

### No unused variables or parameters

`noUnusedLocals` and `noUnusedParameters` are both true. Prefix with `_` if intentionally unused:

```ts
// ✅ ok
function handler(_event: MouseEvent) { ... }
```

### No `const enum`, no legacy decorators

`erasableSyntaxOnly: true` — use regular `enum` or a union type instead.

### Strict null checks

`strict: true` is on. Never assume a value is non-null without a guard.

---

## 6. Pre-Commit Checklist

Run all three every time before committing. All must pass with zero errors.

```bash
cd frontend

# Type check (catches import errors, null issues, unused vars)
npx tsc --noEmit

# Unit tests (49 tests — DCF, DDM, Comps, financialMath, excelExporter)
npm test

# Production build (catches Vite bundling issues)
npm run build
```

---

## 7. Components (`frontend/src/components/`)

| Component | What it does |
|-----------|-------------|
| `App.tsx` | Root — all global state, tab routing, run lifecycle |
| `ValuationTabs.tsx` | Tab switcher; passes `currentPrice`, `assumptions`, `dcfConfig` to each tab |
| `DCFTab.tsx` | WACC build-up, FCF projection table, sensitivity matrix, all DCF assumption fields |
| `DDMTab.tsx` | 4-criteria applicability checklist, dividend projections, DDM implied price |
| `CompsTab.tsx` | Peer multiples table, implied prices by multiple, weighted blend |
| `ScenariosTab.tsx` | Bear/Base/Bull drivers and probability-weighted expected price |
| `OverviewTab.tsx` | KPI strip, football field chart, investment thesis, key risks |
| `CompetitiveTab.tsx` | Subject vs. peers benchmarking table |
| `ForecastsTab.tsx` | Revenue forecast overrides |
| `AssumptionField.tsx` | Editable assumption with SourceChip, range warning, correction message, and optional `tooltip` prop (hover `?` badge) |
| `UpsideLabel.tsx` | Large color-coded upside/downside % banner vs. current price — green for upside, red for downside |
| `CalcBreakdown.tsx` | Collapsible "How this number was calculated" with formula + actual values |
| `DataField.tsx` | Editable raw financial data input (revenue, debt, shares, etc.) |
| `DeltaIndicator.tsx` | Shows change vs. previous run price |
| `WACCBuildupCard.tsx` | Visual WACC decomposition summary card |
| `FootballField.tsx` | Recharts bar chart of all valuation methods vs. current price |
| `CollapsibleCard.tsx` | Wrapper card with expand/collapse toggle |
| `SourceChip.tsx` | Small chip showing assumption source and confidence level |
| `WeightSlider.tsx` | Drag slider for model blending weights |
| `TickerInput.tsx` | Ticker entry with clickable example chips: AAPL, MSFT, NVDA |
| `OnboardingGuide.tsx` | First-run setup steps with plain-English description of the tool |
| `SettingsModal.tsx` | API key configuration modal |
| `AgentLogPanel.tsx` | Streaming SSE log from the AI agent |
| `RunHistorySidebar.tsx` | Sidebar list of previous runs (from IndexedDB) |
| `EmptyState.tsx` | Shown before any run has been started |
| `ErrorState.tsx` | Shown when a run fails |
| `ExportButton.tsx` | Triggers XLSX or PDF export |
| `CritiquePanel.tsx` | AI critique and refine panel for assumptions |
| `PriceChart.tsx` | Historical stock price chart |
| `ReturnHistory.tsx` | Historical return chart |

---

## 8. Services (`frontend/src/services/`)

| File | Purpose |
|------|---------|
| `dcfEngine.ts` | DCF: FCFF/FCFE projections, Gordon Growth + Exit Multiple terminal values, WACC, sensitivity matrix (5×5) |
| `ddmEngine.ts` | Two-stage DDM with 4-criteria applicability check |
| `compsEngine.ts` | Peer median multiples → implied prices with weighting (40% EV/EBITDA, 30% P/E, 20% EV/Sales, 10% P/B) |
| `scenarioEngine.ts` | Bear/Base/Bull full DCF re-run with probability weighting |
| `blendingEngine.ts` | Weights DCF/DDM/Comps into a single blended price target |
| `agentRunner.ts` | SSE stream parser for the AI agent `/api/analyze` endpoint |
| `financialFetcher.ts` | All API calls: pipeline, financials summary, peers, health check |
| `assumptionValidator.ts` | Validates and clamps AI-generated assumption values |
| `forecastEngine.ts` | Revenue forecast projection engine |
| `forecastFetcher.ts` | Fetches forecast presets from backend |
| `database.ts` | IndexedDB via Dexie — saves and loads run history |
| `excelExporter.ts` | Multi-sheet XLSX export matching Smit Financial Model structure |
| `pdfExporter.ts` | PDF executive summary with football field and key assumptions |

---

## 9. Hooks (`frontend/src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useValuationRun.ts` | Orchestrates the full run lifecycle: pipeline → fetch → AI agent → calculate |
| `useAssumptions.ts` | Manages user assumption overrides on top of AI-generated values |
| `useDataOverrides.ts` | Manages user overrides of raw financial data inputs |
| `useValuationConfig.ts` | DCF config (cashFlowBasis, discountingConvention) and model blending weights |
| `useForecastOverrides.ts` | Revenue forecast override state |
| `useRunHistory.ts` | IndexedDB run history — list, load, delete |
| `useSettings.ts` | API key, provider, and settings modal state |
| `useCritique.ts` | AI critique and assumption-refine workflow |

---

## 10. Types (`frontend/src/types/`)

| File | Key interfaces |
|------|---------------|
| `Assumptions.ts` | `SourcedAssumption`, `WACCAssumptions`, `DCFAssumptions`, `DDMAssumptions`, `CompsAssumptions`, `ScenarioAssumptions` |
| `ValuationRun.ts` | `ValuationRun` — includes `currentPrice`, `dcfOutput`, `ddmOutput`, `compsOutput`, `previousPrices`, `scenarioOutput`, `forecastPresets`, `aiRecommendedConfig` |
| `FinancialData.ts` | `FinancialData` — all company financials fed into engines |
| `DCFOutput.ts` | `DCFOutput` — projections array, terminal values, sensitivity matrix, implied prices (Gordon, Exit, Blended) |
| `DDMOutput.ts` | `DDMOutput` — `applicabilityCriteria[]`, `dpsProjections[]`, `singleStagePrice`, `twoStagePrice`, `impliedPrice` |
| `CompsOutput.ts` | `CompsOutput` — `peerTable[]`, `medians`, `impliedPrices[]`, `weightedImpliedPrice` |
| `BlendedOutput.ts` | `BlendedOutput` — weighted blend of all three models |
| `ScenarioOutput.ts` | `ScenarioOutput` — bear/base/bull results + expected price |
| `ForecastOutput.ts` | `ForecastOutput` — revenue and margin projection series |
| `ValuationConfig.ts` | `DCFConfig`, `CashFlowBasis` enum, `DiscountingConvention` enum, model weights |
| `CritiqueResult.ts` | `CritiqueResult` — AI critique findings and suggested refinements |

---

## 11. Valuation Model Formulas

### DCF

```
UFCF = Revenue × EBITDA_margin × (1 − tax_rate) + D&A − CapEx − ΔNWC
TV (Gordon Growth)  = FCF₅ × (1 + g) / (WACC − g)
TV (Exit Multiple)  = EBITDA₅ × exit_multiple
Blended TV          = 40% Gordon + 60% Exit Multiple
Implied Price       = (EV − Net Debt) / Shares Outstanding
```

### WACC

```
Cost of Equity (ke) = Rf + β × ERP + size_premium
After-Tax Cost of Debt = kd × (1 − tax_rate)
WACC = (E/V) × ke + (D/V) × kd(1−t)
```

### DDM (Two-Stage)

```
Stage 1 = PV of dividends for 5 years at short_term_growth
Stage 2 = TV = D₅ × (1 + g_lt) / (ke − g_lt)
Implied Price = PV(Stage 1) + PV(Stage 2)
```

### Comps

```
Implied EV    = peer_median_multiple × subject_metric
Implied Price = (Implied EV − Net Debt) / Shares Outstanding
Weighted      = 40% EV/EBITDA + 30% P/E + 20% EV/Sales + 10% P/B
```

---

## 12. AssumptionField Tooltip Convention

Every `AssumptionField` for a named financial concept should have a `tooltip` prop — one plain-English sentence explaining what the number means and why it matters. It renders as a `?` badge that shows the tooltip on hover.

Existing tooltips are defined as `TOOLTIPS` objects at the top of `DCFTab.tsx` and `DDMTab.tsx`. When adding new assumption fields, add a corresponding tooltip entry in the same pattern.

---

## 13. Environment Variables

### Backend (Render — set as environment secrets, never commit real keys)

| Variable | Value in production | Purpose |
|----------|--------------------|---------|
| `VALUATION_DASHBOARD_ALLOWED_ORIGINS` | `https://valuation-dashboard-f2f.pages.dev` | CORS — who can call the API |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Server-side Claude key (users don't need their own) |
| `PERPLEXITY_API_KEY` | `pplx-...` | Optional Perplexity provider |
| `GEMINI_API_KEY` | `...` | Optional Gemini provider |
| `DATA_DIR` | `/data` | Where `raw_data.xlsx` and cache live (Render disk mount) |
| `VALUATION_DASHBOARD_BACKEND_HOST` | `0.0.0.0` | Bind to all interfaces in container |

### Frontend (Cloudflare Pages — build-time only)

| Variable | Value in production | Purpose |
|----------|--------------------|---------|
| `VITE_API_BASE_URL` | `https://valuation-dashboard-api.onrender.com` | Where the frontend sends API calls |

**Local dev:** Leave `VITE_API_BASE_URL` unset — Vite proxies `/api` to `localhost:8000` automatically.

---

## 14. Local Development

```bash
# Backend (Terminal 1)
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000 --reload

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

No extra env vars needed for local dev. The Vite proxy handles `/api` routing automatically.

---

## 15. Common Pitfalls

1. **Missing `.tsx`/`.ts` on imports** — always include the file extension on local imports or `tsc --noEmit` will fail.

2. **Forgetting `import type`** — use `import type { Foo }` whenever importing only a TypeScript type, not a runtime value.

3. **Unused variables** — `noUnusedLocals` is on. If a variable or param isn't used, remove it or prefix with `_`.

4. **`currentPrice` wiring** — `UpsideLabel` in DCFTab, DDMTab, and CompsTab all receive `currentPrice` from `ValuationTabs` via `run.currentPrice`. If you add a new tab with an implied price card, wire it the same way.

5. **Assumption override paths** — overrides use dot-notation strings like `'wacc.risk_free_rate'` or `'dcf.terminal_growth_rate'`, handled in `useAssumptions.ts`. Match the path exactly to the field name in the `Assumptions` type.

6. **`raw_data.xlsx` must exist on Render** — the Render disk at `/data` persists it between requests. If you wipe the disk or redeploy with a fresh volume, users must run the pipeline for a ticker first before any analysis will work.

7. **Cloudflare Pages auto-deploys on push** — every `git push origin master` triggers a new Pages build. Make sure `npm run build` passes locally before pushing if you don't want a broken production deploy.

8. **Render sleeps on free tier** — do not mistake a 30-second cold start for the backend being broken. The frontend handles it gracefully.

---

## 16. Keeping This File Accurate

Whenever you make a change that contradicts something written in this file, update it in the same commit. Examples:

- Add or rename a component → update section 7
- Add or rename a service / hook / type → update sections 8 / 9 / 10
- Change a deployment URL, host, or env var → update sections 2 and 13
- Change tsconfig flags → update section 5
- Add or change an API route → update section 4 (and section 8 if a fetcher changes)
- Change the test count → update sections 6 and the testing line in section 3 tech stack

If you spot something here that no longer matches the code, fix the doc — don't just leave it stale.
