export interface ForecastItem {
  year: number
  value: number
  confidence: 'high' | 'medium' | 'low'
  rationale: string
}

export interface AccountOverride {
  account: string
  new_value: number
  rationale: string
}

export interface ForecastAssumptions {
  revenue_forecasts: ForecastItem[]
  ebit_margins: ForecastItem[]
  ebitda_margins: ForecastItem[]
  effective_tax_rate: number
  account_overrides: AccountOverride[]
  revenue_thesis: string
  margin_thesis: string
  key_assumptions: string[]
}

export interface PresetAssumptions {
  revenue_growth_rates: number[]
  ebit_margin: number
  ebitda_margin: number
  cogs_pct_revenue: number
  rnd_pct_revenue: number
  sga_pct_revenue: number
  effective_tax_rate: number
  da_pct_ppe: number
  dso_days: number
  dio_days: number
  dpo_days: number
  capex_pct_revenue: number
  sbc_pct_revenue: number
  dividend_payout_ratio: number
  share_repurchase_annual: number
  debt_repayment_annual: number
  new_debt_issuance: number
  cost_of_debt: number
  other_ca_pct_revenue: number
  other_cl_pct_revenue: number
}

export interface BaseYearData {
  total_revenue: number
  cost_of_revenue: number
  gross_profit: number
  rnd_expense: number
  sga_expense: number
  ebit: number
  ebitda: number
  da: number
  interest_expense: number
  pretax_income: number
  tax_provision: number
  net_income: number
  diluted_shares: number
  cash: number
  accounts_receivable: number
  inventories: number
  other_current_assets: number
  total_current_assets: number
  ppe_net: number
  goodwill: number
  other_noncurrent_assets: number
  total_assets: number
  accounts_payable: number
  current_debt: number
  other_current_liabilities: number
  total_current_liabilities: number
  long_term_debt: number
  other_noncurrent_liabilities: number
  total_liabilities: number
  stockholders_equity: number
  total_debt: number
  operating_cf: number
  capex: number
  sbc: number
  dividends_paid: number
  repurchases: number
  fcf: number
}

export interface ForecastStatements {
  incomeStatement: Record<string, number[]>
  balanceSheet: Record<string, number[]>
  cashFlow: Record<string, number[]>
  dcfInputs: Record<string, number[]>
}

export interface ForecastValidation {
  /** True only when Total Assets equals L&E for every projected year. */
  balanced: boolean
  maxDiff: number
  issues: string[]
  /** Soft-warning issues that do not unbalance the BS (e.g. negative cash plug). */
  warnings?: string[]
}

export interface ForecastOutput {
  statements: ForecastStatements
  mergedPresets: PresetAssumptions
  aiForecasts: ForecastAssumptions | null
  validation: ForecastValidation
  revenues: number[]
}
