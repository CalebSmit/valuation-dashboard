export interface AnnualDataPoint {
  year: string
  value: number
}

export interface PriceDataPoint {
  date: string
  close: number
}

export interface PeriodReturns {
  ytd: number | null
  oneYear: number | null
  threeYear: number | null
  fiveYear: number | null
}

export interface RiskMetrics {
  annualizedVolatility: number | null
  sharpeRatio: number | null
  treynorRatio: number | null
  sortinoRatio: number | null
}

export interface CompetitorData {
  ticker: string
  companyName: string
  marketCap: number | null
  pe: number | null
  enterpriseValue: number | null
  salesTTM: number | null
  ebitdaTTM: number | null
  stockholdersEquity: number | null
  profitMargin: number | null
  operatingMargin: number | null
  roe: number | null
  debtToEquity: number | null
  beta: number | null
}

export interface OptionsSummary {
  nearestExpiry: string | null
  avgCallIV: number | null
  avgPutIV: number | null
  putCallVolumeRatio: number | null
  putCallOpenInterestRatio: number | null
  callVolume: number | null
  putVolume: number | null
  callOpenInterest: number | null
  putOpenInterest: number | null
}

export interface InstitutionalHolder {
  holder: string
  shares: number | null
  dateReported: string
  percentOut: number | null
  value: number | null
}

export interface InsiderTransaction {
  insider: string
  position: string
  transaction: string
  shares: number | null
  value: number | null
  date: string
}

export interface OwnershipConcentration {
  topHoldersPercent: number | null
  topHolderCount: number
}

export interface NewsItem {
  title: string
  publisher: string
  link: string
  published: string
}

export interface EarningsCalendar {
  nextEarningsDate: string | null
  epsEstimate: number | null
  epsHigh: number | null
  epsLow: number | null
  revenueEstimate: number | null
  revenueHigh: number | null
  revenueLow: number | null
}

export interface EarningsSurpriseSummary {
  beats: number
  misses: number
  averageSurprisePct: number | null
  lastSurprisePct: number | null
}

export interface DividendMetricsDetail {
  annualDividendRate: number | null
  currentDividendYieldPct: number | null
  payoutRatioPct: number | null
  fiveYearCagrPct: number | null
  threeYearCagrPct: number | null
  yearsOfHistory: number | null
  paymentFrequency: string
}

export interface FinancialData {
  ticker: string
  companyName: string
  sector: string
  industry: string
  businessSummary: string
  currentPrice: number | null
  sharesOutstanding: number | null

  // Valuation metrics
  marketCap: number | null
  enterpriseValue: number | null
  peRatioTTM: number | null
  forwardPE: number | null
  pbRatio: number | null
  evToEbitda: number | null
  evToRevenue: number | null
  profitMargin: number | null
  operatingMargin: number | null
  roe: number | null
  roa: number | null
  debtToEquity: number | null
  currentRatio: number | null
  beta: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null

  // Historical series
  revenueHistory: AnnualDataPoint[]
  ebitdaHistory: AnnualDataPoint[]
  revenueLatest: number | null
  operatingIncome: number | null

  // Balance sheet
  totalDebt: number | null
  totalCash: number | null
  totalEquity: number | null

  // Cash flow
  operatingCashFlow: number | null
  capex: number | null
  freeCashFlow: number | null
  depreciationAndAmortization: number | null
  interestExpense: number | null
  netBorrowing: number | null

  // DDM metrics
  dividendYield: number | null
  annualDividendRate: number | null
  payoutRatio: number | null
  dividendGrowth5yr: number | null
  dividendGrowth3yr: number | null
  yearsOfDividendHistory: number | null
  paymentFrequency: string

  // Beta analysis
  regressionBeta: number | null
  betaRSquared: number | null
  betaStdError: number | null

  // FRED economic data
  riskFreeRate10yr: number | null
  riskFreeRate5yr: number | null
  fedFundsRate: number | null
  cpi: number | null
  vix: number | null
  realGDPGrowth: number | null

  // Competitors
  competitors: CompetitorData[]

  // Analyst estimates
  analystTargetMean: number | null
  analystTargetLow: number | null
  analystTargetHigh: number | null

  // Price history and return metrics
  stockPriceHistory: PriceDataPoint[]
  periodReturns: PeriodReturns | null
  riskMetrics: RiskMetrics | null

  // Phase 4: optional pipeline data surfaced in dashboard cards. Older
  // raw_data.xlsx workbooks may not include every sheet, so each field
  // is optional and consumers must handle empty/null cases.
  optionsSummary?: OptionsSummary
  institutionalHolders?: InstitutionalHolder[]
  insiderTransactions?: InsiderTransaction[]
  ownershipConcentration?: OwnershipConcentration
  recentNews?: NewsItem[]
  earningsCalendar?: EarningsCalendar
  earningsSurpriseSummary?: EarningsSurpriseSummary
  dividendMetricsDetail?: DividendMetricsDetail
}
