// Backend API base URL.
// In dev, Vite proxies /api to localhost:8000 so this stays empty.
// For a split deployment (frontend on Cloudflare Pages, backend on Fly.io/Render/etc.),
// set VITE_API_BASE_URL=https://your-api.example.com in the Cloudflare Pages env vars.
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

// Default valuation assumptions (Damodaran / FRED)
export const DEFAULT_RISK_FREE_RATE = 0.0406
export const DEFAULT_EQUITY_RISK_PREMIUM = 0.0423
export const DEFAULT_SIZE_PREMIUM = 0.0
export const DEFAULT_TERMINAL_GROWTH_RATE = 0.025
export const DEFAULT_TAX_RATE = 0.21
export const DEFAULT_EXIT_MULTIPLE = 10.0
export const DEFAULT_COMPS_WEIGHTS: {
  ev_ebitda: number
  pe: number
  ev_sales: number
  pb: number
} = {
  ev_ebitda: 0.40,
  pe: 0.30,
  ev_sales: 0.20,
  pb: 0.10,
}
export const DEFAULT_SCENARIO_PROBABILITIES: {
  bear: number
  base: number
  bull: number
} = {
  bear: 0.25,
  base: 0.50,
  bull: 0.25,
}

// Assumption validation bounds
export const BOUNDS = {
  riskFreeRate: { min: 0, max: 0.15 },
  equityRiskPremium: { min: 0.02, max: 0.12 },
  beta: { min: -1, max: 5 },
  sizePremium: { min: -0.02, max: 0.10 },
  costOfDebt: { min: 0.01, max: 0.20 },
  debtWeight: { min: 0, max: 1 },
  equityWeight: { min: 0, max: 1 },
  taxRate: { min: 0, max: 0.50 },
  revenueGrowth: { min: -0.50, max: 2.0 },
  ebitdaMargin: { min: -0.50, max: 0.80 },
  capexPctRevenue: { min: 0, max: 0.30 },
  nwcPctRevenue: { min: -0.20, max: 0.30 },
  terminalGrowthRate: { min: 0, max: 0.05 },
  exitMultiple: { min: 2, max: 40 },
  dividendGrowthRate: { min: -0.10, max: 0.30 },
  requiredReturn: { min: 0.04, max: 0.25 },
} as const

// Projection settings
export const PROJECTION_YEARS = 5

// UI strings
export const UI = {
  appTitle: 'Valuation Dashboard',
  analyzeButton: 'ANALYZE',
  recalculateButton: 'RECALCULATE',
  exportButton: 'EXPORT TO EXCEL',
  exportPdfButton: 'EXPORT TO PDF',
  tickerPlaceholder: 'Enter ticker (e.g., AAPL)',
  apiKeyPlaceholder: 'Enter Anthropic API key (sk-ant-...)',
  noDataMessage: 'Enter a ticker and click Analyze to fetch financial data automatically.',
  tabs: {
    overview: 'Overview',
    dcf: 'DCF',
    ddm: 'DDM',
    comps: 'Comps',
    scenarios: 'Scenarios',
    competitive: 'Competitive',
  },
} as const

// Design system colors (matching CSS custom properties)
export const COLORS = {
  bg: '#0D1117',
  surface: '#161B22',
  surfaceAlt: '#21262D',
  border: '#30363D',
  text: '#E6EDF3',
  textMuted: '#8B949E',
  accent: '#00FF88',
  amber: '#F0A500',
  red: '#F85149',
  blueInput: '#4493F8',
  success: '#3FB950',
} as const

// Football field bar colors
export const FOOTBALL_COLORS = {
  dcfBase: '#00FF88',
  dcfRange: '#00FF8866',
  ddm: '#4493F8',
  evEbitda: '#F0A500',
  pe: '#F0A500B3',
  fiftyTwoWeek: '#8B949E',
  inapplicable: '#30363D',
  currentPrice: '#F0A500',
} as const
