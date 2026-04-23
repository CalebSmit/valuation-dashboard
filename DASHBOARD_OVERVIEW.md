# AI Stock Valuation Dashboard — Technical Overview

**Date**: March 30, 2026
**Demo Ticker**: Apple Inc. (AAPL)
**Version**: 1.0

---

## 1. What This Dashboard Does

The AI Stock Valuation Dashboard is a full-stack web application that automates equity valuation analysis. A user enters a ticker symbol and the system:

1. Fetches real-time financial data from multiple sources
2. Runs an AI research agent to generate CFA-grade valuation assumptions
3. Computes three independent valuations (DCF, DDM, Comps) in the browser
4. Displays results in an interactive dashboard with editable assumptions
5. Exports reports to Excel or PDF

The entire process takes approximately 3-5 minutes per ticker.

---

## 2. Architecture

```
+---------------------+          +---------------------+          +------------------+
|   React Frontend    |  <---->  |   FastAPI Backend    |  <---->  |  External APIs   |
|   (Port 5173)       |          |   (Port 8000)        |          |                  |
|                     |          |                      |          |  - Yahoo Finance  |
|  - Valuation engines|          |  - Pipeline runner   |          |  - FRED           |
|  - Interactive UI   |          |  - AI agent router   |          |  - OpenBB         |
|  - Export (XLSX/PDF)|          |  - Peer data fetcher |          |  - Damodaran      |
|  - IndexedDB history|          |  - Excel reader      |          |  - Anthropic API  |
+---------------------+          +---------------------+          +------------------+
                                          |
                                          v
                                 +------------------+
                                 |  raw_data.xlsx   |
                                 |  (59 sheets)     |
                                 +------------------+
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS | UI, valuation calculations, export |
| Backend | Python + FastAPI + Uvicorn | Data pipeline, AI agent, peer data |
| Database | IndexedDB (browser-local, via Dexie) | Run history (no server database) |
| AI Provider | Anthropic Claude API (primary), Gemini, Perplexity (optional) | Assumption generation |

---

## 3. Execution Order — Step by Step

When a user enters "AAPL" and clicks run, the following happens in sequence:

### Phase 1: Data Pipeline (~2-5 minutes)
**What happens**: Backend spawns `py main.py --ticker AAPL` as a subprocess. The pipeline fetches all financial data and writes it to `raw_data.xlsx`.

| Step | Data Source | What It Fetches | Sheets Created |
|------|-----------|-----------------|----------------|
| 1a | OpenBB Platform | Annual income statement (4 years) | Raw_Income_Statement |
| 1b | OpenBB Platform | Annual balance sheet (4 years) | Raw_Balance_Sheet |
| 1c | OpenBB Platform | Annual cash flow (4 years) | Raw_Cash_Flow |
| 1d | OpenBB Platform | Quarterly income statement (6 quarters) | Quarterly_Income_Statement |
| 1e | OpenBB Platform | Quarterly balance sheet (5 quarters) | Quarterly_Balance_Sheet |
| 1f | OpenBB Platform | Quarterly cash flow (5 quarters) | Quarterly_Cash_Flow |
| 1g | yfinance | Company info, sector, industry, price | About |
| 1h | yfinance | Valuation multiples (P/E, EV/EBITDA, etc.) | Valuation Data |
| 1i | yfinance | Shares outstanding history | Shares_Outstanding |
| 1j | yfinance | Dividend metrics, payment history | DDM_Metrics, Dividend_History |
| 1k | yfinance | Relative valuation (subject company metrics) | Relative Valuation |
| 1l | FRED API | 27 economic indicators (Treasury yields, CPI, VIX, GDP, etc.) | FRED_Economic_Data |
| 2 | yfinance + SPY | 5-year weekly returns, OLS regression beta | Beta Analysis |
| 3 | Damodaran website | 15 industry benchmark datasets (betas, cost of capital, tax rates, margins, multiples, ERP) | betas, cost_of_capital, tax_rates, margins, multiples_pe, etc. |
| 4 | yfinance | Dividend metrics, last update timestamp | Dividend_Metrics, Last_Update_Time |
| 5a | yfinance | Analyst EPS/revenue estimates, growth forecasts | Earnings_Estimate, Revenue_Estimate, Growth_Forecasts |
| 5b | yfinance | EPS revision trends, earnings surprise history | EPS_Trends, EPS_Revisions, Earnings_History |
| 5c | yfinance | Analyst buy/sell ratings, recommendation history | Analyst_Ratings, Recommendation_History, Rating_Changes |
| 5d | yfinance | Institutional holdings, insider transactions | Institutional_Holdings, Insider_Transactions, Ownership_Summary, Insider_Roster |
| 5e | yfinance | Options implied volatility, put-call ratios | Options_Summary |
| 5f | yfinance | Earnings dates calendar | Earnings_Dates |
| 5g | yfinance | Additional metrics (PEG, FCF, margins) | Additional_Metrics |
| 5h | yfinance | Stock split history | Stock_Splits |
| 5i | yfinance | Recent news headlines, SEC filings | News, SEC_Filings |
| 5j | yfinance | Historical/implied volatility, short interest | Volatility_Analysis, Short_Interest |
| 5k | yfinance | 3-year daily stock price history | Stock_History_Daily |

**Output**: `raw_data.xlsx` with 59 sheets, containing all financial data needed for valuation.

### Phase 2: Financial Data Loading (~1 second)
**What happens**: Backend reads `raw_data.xlsx` and extracts a compact financial summary (~2KB JSON) containing the key metrics the AI agent and frontend need.

Key data extracted:
- Company info (name, sector, industry, price, shares outstanding)
- Valuation multiples (P/E, EV/EBITDA, EV/Revenue, etc.)
- Income statement history (revenue and EBITDA series)
- Balance sheet snapshot (debt, cash, equity)
- Cash flow snapshot (operating CF, CapEx, FCF)
- DDM inputs (dividend yield, payout ratio, growth rates, payment history)
- Beta analysis (regression beta, R-squared)
- FRED data (Treasury yields, GDP growth, VIX)
- Analyst estimates (EPS and revenue consensus by period)
- Capital structure (market-value debt/equity weights, implied cost of debt)

### Phase 3: AI Research Agent (~10-30 seconds)
**What happens**: The financial summary is sent to Claude (Anthropic API) along with a CFA-grade system prompt. The AI generates all valuation assumptions with source citations and confidence levels.

Two modes available:
- **Standard Mode** (~$0.01/run): Single API call, no web search, uses provided data only
- **Deep Research Mode** (~$0.03-0.08/run): Multi-turn with Anthropic's built-in web search tool for real-time citations from earnings calls, analyst reports, and Damodaran's website

**What the AI produces** (structured output via tool calling):

| Category | Assumptions Generated | Example (AAPL) |
|----------|----------------------|----------------|
| DCF Revenue Growth | 5 years of projected growth rates | Y1: 11.7%, Y2: 6.9%, Y3: 6.0%, Y4: 4.0%, Y5: 3.5% |
| DCF Margins | EBITDA margin, CapEx %, NWC %, tax rate | 34.8% EBITDA margin, 3.1% CapEx, -2.0% NWC |
| DCF Terminal | Terminal growth rate, exit multiple | 2.5% growth, 15.0x EV/EBITDA |
| WACC | Risk-free rate, ERP, beta, cost of debt, weights | Rf=4.06%, ERP=4.23%, Beta=1.163, WACC=9.2% |
| DDM | Applicability assessment, growth rates, required return | Applicable, 5.0% short-term growth, 2.5% long-term |
| Comps | 3-5 peer tickers, selection rationale, multiple weights | MSFT, GOOGL, AMZN, META, TSLA |
| Scenarios | Bear/Base/Bull drivers for revenue, margin, multiple, WACC | Bear: 8% rev, 32% margin; Bull: 15% rev, 37% margin |
| Thesis | 3-sentence investment thesis | "Fairly valued with 15-20% upside..." |
| Risks | 3-5 company-specific risks | Memory costs, China exposure, App Store regulation |

Every assumption includes:
- **Value** (decimal form, e.g., 0.117 = 11.7%)
- **Source** (e.g., "Q1 2026 earnings call guidance")
- **Confidence** (high / medium / low)
- **Rationale** (1-2 sentence explanation)

### Phase 4: Peer Data Fetch (~1-2 seconds)
**What happens**: The AI agent selects 3-5 comparable companies. The backend fetches their financial metrics from yfinance in parallel (market cap, EV, P/E, EBITDA, revenue, equity) so the comps engine has real data to work with.

For AAPL, the AI selected: **MSFT, GOOGL, AMZN, META, TSLA**

### Phase 5: Valuation Calculations (instant, in-browser)
**What happens**: Four TypeScript calculation engines run entirely in the browser — no server round-trip needed. This enables instant recalculation when the user changes any assumption.

---

## 4. The Four Valuation Models

### 4.1 Discounted Cash Flow (DCF)

**Formula**: Enterprise Value = Sum of PV(Unlevered FCF) + PV(Terminal Value)

```
UFCF = Revenue x EBITDA Margin x (1 - Tax Rate) + D&A - CapEx - Change in NWC

Terminal Value (Gordon Growth):  TV = FCF_5 x (1+g) / (WACC - g)
Terminal Value (Exit Multiple):  TV = EBITDA_5 x Exit Multiple

Implied Price = (Enterprise Value - Net Debt) / Shares Outstanding
Blended Price = 40% Gordon + 60% Exit Multiple
```

**WACC Construction** (Pure CAPM):
```
Cost of Equity = Risk-Free Rate + Beta x Equity Risk Premium + Size Premium
After-Tax Cost of Debt = Cost of Debt x (1 - Tax Rate)
WACC = (E/V) x ke + (D/V) x kd(1-t)
```

Includes a **sensitivity matrix**: WACC (+-2%) vs Exit Multiple (+-2) = 25 scenario grid.

### 4.2 Dividend Discount Model (DDM)

**Applicability check** (4 criteria — needs 3+ to pass):
1. Company pays dividends (yield > 0)
2. 5+ years of dividend history
3. Payout ratio between 20-80%
4. Positive earnings (P/E > 0)

**Two-Stage DDM**:
```
Stage 1: PV of dividends during high-growth phase (5 years)
Stage 2: Terminal value using Gordon Growth with long-term rate
Implied Price = PV(Stage 1) + PV(Stage 2)
```

For AAPL: DDM is applicable (11 years of history, quarterly payments), but the 13% payout ratio and negative historical growth make it a secondary method.

### 4.3 Comparable Company Analysis (Comps)

**Process**:
1. AI selects 3-5 peers (same sector, similar size/growth)
2. Backend fetches peer financial data (market cap, EV, EBITDA, revenue, P/E)
3. Calculate peer median multiples (EV/EBITDA, P/E, EV/Sales, P/B)
4. Apply medians to subject company metrics
5. Weight: EV/EBITDA 40%, P/E 30%, EV/Sales 20%, P/B 10%

```
Implied EV = Peer Median EV/EBITDA x Subject EBITDA
Implied Equity = Implied EV - Net Debt
Implied Price = Implied Equity / Shares Outstanding
```

### 4.4 Scenario Analysis (Bear / Base / Bull)

**Process**:
1. AI defines three scenarios with specific catalysts:
   - **Bear** (25% probability): Consumer slowdown, margin compression
   - **Base** (50% probability): Matches DCF base case
   - **Bull** (25% probability): AI-driven super-cycle, China recovery
2. Each scenario adjusts: revenue growth, EBITDA margin, exit multiple, WACC
3. Full DCF/DDM/Comps re-run for each scenario
4. Expected price = probability-weighted average

---

## 5. What Comes From Where

### Data sourced from yfinance (market data)
- Current stock price, market cap, enterprise value
- Historical financial statements (income, balance sheet, cash flow)
- Valuation multiples (P/E, EV/EBITDA, P/B, etc.)
- Dividend history and metrics
- Analyst estimates (EPS and revenue consensus)
- Analyst ratings (buy/hold/sell counts)
- Institutional/insider ownership
- Options data, short interest
- Stock price history (3 years daily)
- Peer company financial metrics (after AI selects peers)

### Data sourced from OpenBB Platform (primary for financial statements)
- Annual and quarterly income statements
- Annual and quarterly balance sheets
- Annual and quarterly cash flow statements
- Uses snake_case field names (e.g., `total_revenue`, `operating_income`)
- Falls back to yfinance if OpenBB fails

### Data sourced from FRED (economic indicators)
- Treasury yield curve (3-month through 30-year)
- Federal funds rate
- CPI, PCE price index
- Real GDP growth rate
- Unemployment rate, labor force participation
- VIX volatility index
- Moody's BAA corporate bond yield
- Yield curve spreads
- Recession indicator

### Data sourced from Damodaran (industry benchmarks)
- Industry betas (levered and unlevered)
- Cost of capital by industry
- Effective tax rates by industry
- Operating margins by industry
- Return on equity/capital by industry
- Equity risk premium (implied)
- Industry multiples (P/E, P/B, P/S, EV/EBITDA)
- Synthetic credit ratings
- Cached for 7 days (data updates approximately annually)

### Generated by AI Agent (Anthropic Claude API)
- Revenue growth projections (5 years)
- EBITDA margin assumption
- CapEx and NWC as % of revenue
- Tax rate
- Terminal growth rate and exit multiple
- All WACC component assumptions
- DDM applicability assessment and growth rates
- Comparable company selection (3-5 peers)
- Bear/Base/Bull scenario definitions with specific catalysts
- Investment thesis (3 sentences)
- Key risks (3-5 company-specific)
- Source citations and confidence levels for every assumption

### Calculated in Browser (TypeScript engines)
- WACC (from component inputs)
- 5-year free cash flow projections
- Terminal value (Gordon Growth and Exit Multiple methods)
- DCF implied price (blended 40/60)
- Sensitivity matrix (WACC vs Exit Multiple)
- DDM implied price (two-stage model)
- Comps implied price (weighted multiples)
- Scenario analysis (Bear/Base/Bull with probability weighting)
- Football field chart ranges

---

## 6. AAPL Demo Run — Key Results

**Run Date**: March 30, 2026
**Mode**: Deep Research (with web search)
**AI Provider**: Anthropic Claude (claude-sonnet-4)
**Current Price**: $246.26

### Financial Snapshot (from raw_data.xlsx)
| Metric | Value |
|--------|-------|
| Market Cap | $3.62 trillion |
| Enterprise Value | $3.68 trillion |
| Revenue (LTM) | $435.6 billion |
| EBITDA (LTM) | $152.9 billion |
| Net Income (LTM) | $112.0 billion |
| Free Cash Flow (LTM) | $106.3 billion |
| P/E (TTM) | 31.1x |
| EV/EBITDA | 24.0x |
| Regression Beta | 1.163 (R-squared: 48.2%) |
| Dividend Yield | 0.42% |
| Analyst Consensus | Buy (2.44), 48 analysts |
| Analyst Target Mean | $295.31 |

### AI-Generated Assumptions
| Assumption | Value | Source | Confidence |
|------------|-------|--------|------------|
| Revenue Growth Y1 | 11.7% | Analyst consensus for FY2026 | High |
| Revenue Growth Y2 | 6.9% | Analyst consensus for FY2027 | High |
| Revenue Growth Y3 | 6.0% | Industry outlook + trend fade | Medium |
| Revenue Growth Y4 | 4.0% | Long-term industry growth | Medium |
| Revenue Growth Y5 | 3.5% | GDP-plus approach rate | Medium |
| EBITDA Margin | 34.8% | 3-year average (2023-2025) | High |
| CapEx % Revenue | 3.1% | 2025 actual ($12.7B / $416B) | High |
| Tax Rate | 17.5% | Q1 2026 earnings call guidance | High |
| Terminal Growth | 2.5% | US nominal GDP growth | Medium |
| Exit Multiple | 15.0x | Conservative peer median | Medium |
| Risk-Free Rate | 4.06% | 10-Year Treasury yield (FRED) | High |
| Equity Risk Premium | 4.23% | Damodaran implied ERP, Jan 2026 | High |
| Beta | 1.163 | 5-year regression vs SPY | Medium |
| WACC | ~9.2% | Computed from components | High |

### AI-Selected Peers
| Peer | Rationale |
|------|-----------|
| MSFT | Large-cap tech, ecosystem-driven, similar margins |
| GOOGL | Mega-cap tech, advertising + cloud revenue |
| AMZN | Consumer tech + services, market leadership |
| META | Large-cap tech, advertising + AI investment |
| TSLA | Consumer tech, premium brand, high growth |

### Investment Thesis (AI-generated)
> "Apple's dominant ecosystem position and $3.6T market cap reflect strong competitive moats, but current valuation of $246 appears fairly valued to slightly undervalued with 15-20% upside potential. The iPhone 17 cycle with Apple Intelligence features should drive a multi-year upgrade supercycle, while the high-margin Services business provides recurring revenue stability."

### Key Risks (AI-generated)
1. Memory cost inflation impacting gross margins (flagged in Q1 2026 earnings call)
2. China geopolitical tensions disrupting 20%+ of total revenue
3. Regulatory pressure on App Store business model and 30% commission
4. Competition in AI/services from Google and Microsoft
5. iPhone market saturation and longer replacement cycles

---

## 7. Dashboard Features

### Interactive Assumptions
Every AI-generated assumption is editable. Click any value to override it. The dashboard instantly recalculates all valuations with the new inputs. Original AI values are preserved for comparison.

### Six Tabs
| Tab | Content |
|-----|---------|
| **Overview** | KPI strip, football field chart, investment thesis, key risks |
| **DCF** | WACC build-up, revenue projections, FCF table, terminal value, sensitivity matrix |
| **DDM** | Applicability checklist, dividend projections, implied price |
| **Comps** | Peer multiples table, implied prices per multiple, weighted blend |
| **Scenarios** | Bear/Base/Bull assumption drivers, probability-weighted expected price |
| **Competitive** | Subject vs. peers benchmarking table |

### Export
- **Excel**: Multi-sheet workbook with assumptions, projections, sensitivity matrix
- **PDF**: Executive summary with football field chart, valuation table, key assumptions

### Run History
All completed runs are saved to browser-local IndexedDB. Users can reload previous analyses from the sidebar.

---

## 8. Cost Per Run

| Component | Cost |
|-----------|------|
| Data pipeline (yfinance, OpenBB, FRED, Damodaran) | Free |
| AI Agent — Standard Mode | ~$0.01 |
| AI Agent — Deep Research Mode (with web search) | ~$0.03-0.08 |
| Peer data fetch (yfinance) | Free |
| Browser calculations | Free |
| **Total per run** | **$0.01 - $0.08** |

---

## 9. Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend Framework | React | 19.2 |
| Build Tool | Vite | Latest |
| Styling | Tailwind CSS | 4.x |
| Charts | Recharts | 3.8 |
| Type System | TypeScript | 5.x |
| Backend Framework | FastAPI | 0.115 |
| Python | Python | 3.13 |
| AI SDK | Anthropic Python SDK | 0.52 |
| Financial Data | yfinance, OpenBB Platform | Latest |
| Excel I/O | openpyxl, pandas | Latest |
| Export | SheetJS (xlsx), jsPDF, html2canvas | Latest |
| Local Storage | Dexie (IndexedDB wrapper) | 4.4 |

---

## 10. File Structure

```
valuation-dashboard/
  backend/
    main.py                     FastAPI app entry point
    config.py                   Path resolution, env parsing
    routers/
      pipeline.py               POST /api/pipeline/{ticker} — runs py main.py
      analyze.py                POST /api/analyze/{ticker} — AI agent
      peers.py                  GET  /api/peers?tickers=... — peer data fetch
      sheets.py                 GET  /api/sheets — raw_data.xlsx reader
      financials.py             GET  /api/financials/summary — financial summary
    services/
      pipeline_runner.py        Subprocess management for main.py
      agent.py                  CFA-grade system prompt + tool schema
      peer_fetcher.py           Lightweight yfinance peer data fetcher
      excel_reader.py           raw_data.xlsx reader (cached)
      financial_summarizer.py   Extracts compact summary from 59 sheets
      providers/
        anthropic_adapter.py    Claude API (standard + deep research)
        gemini_adapter.py       Google Gemini API
        perplexity_adapter.py   Perplexity Sonar API

  frontend/
    src/
      App.tsx                   Main layout, tab routing, state management
      hooks/
        useValuationRun.ts      Orchestration: pipeline -> fetch -> AI -> calculate
        useAssumptions.ts       Assumption override management
      services/
        financialFetcher.ts     API calls (pipeline, summary, peers, health)
        agentRunner.ts          SSE stream parser for AI agent
        dcfEngine.ts            DCF calculation engine
        ddmEngine.ts            DDM calculation engine
        compsEngine.ts          Comps calculation engine
        scenarioEngine.ts       Bear/Base/Bull scenario engine
        excelExporter.ts        XLSX export
        pdfExporter.ts          PDF export
        database.ts             IndexedDB (Dexie) for run history
      components/
        OverviewTab.tsx         KPI strip, football field, thesis
        DCFTab.tsx              WACC, projections, sensitivity matrix
        DDMTab.tsx              Applicability, dividend projections
        CompsTab.tsx            Peer multiples, implied prices
        ScenariosTab.tsx        Bear/Base/Bull analysis
        CompetitiveTab.tsx      Peer benchmarking
        FootballField.tsx       Recharts bar visualization
        AssumptionField.tsx     Editable assumption with source chip
        SettingsModal.tsx       API key configuration
      types/
        Assumptions.ts          DCF, WACC, DDM, Comps, Scenario types
        FinancialData.ts        Company info, metrics, competitor data
        ValuationRun.ts         Run lifecycle, status, log entries
        DCFOutput.ts            DCF engine output types
        CompsOutput.ts          Comps engine output types
        DDMOutput.ts            DDM engine output types
```
