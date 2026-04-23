export interface SourcedAssumption {
  value: number
  source: string
  confidence: 'high' | 'medium' | 'low'
  rationale: string
}

export interface DCFAssumptions {
  revenue_growth_rates: SourcedAssumption[]
  ebitda_margin: SourcedAssumption
  capex_pct_revenue: SourcedAssumption
  nwc_pct_revenue: SourcedAssumption
  tax_rate: SourcedAssumption
  terminal_growth_rate: SourcedAssumption
  exit_multiple: SourcedAssumption
  mid_year_convention: boolean
}

export interface WACCAssumptions {
  risk_free_rate: SourcedAssumption
  equity_risk_premium: SourcedAssumption
  beta: SourcedAssumption
  size_premium: SourcedAssumption
  cost_of_debt: SourcedAssumption
  debt_weight: SourcedAssumption
  equity_weight: SourcedAssumption
  tax_rate: SourcedAssumption
}

export interface DDMAssumptions {
  is_applicable: boolean
  applicability_reason: string
  short_term_growth_rate: SourcedAssumption | null
  long_term_growth_rate: SourcedAssumption | null
  required_return: SourcedAssumption | null
  high_growth_years: number
}

export interface CompsAssumptions {
  selected_peers: string[]
  peer_selection_rationale: string
  primary_multiple: string
  multiple_rationale: string
  multiple_weights: {
    ev_ebitda: number
    pe: number
    ev_sales: number
    pb: number
  }
}

export interface ScenarioDrivers {
  bear: SourcedAssumption
  base: SourcedAssumption
  bull: SourcedAssumption
}

export interface ScenarioAssumptions {
  revenue_growth: ScenarioDrivers
  ebitda_margin: ScenarioDrivers
  exit_multiple: ScenarioDrivers
  wacc: ScenarioDrivers
  probabilities: {
    bear: number
    base: number
    bull: number
  }
}

export interface ForecastItemAssumption {
  year: number
  value: number
  confidence: 'high' | 'medium' | 'low'
  rationale: string
}

export interface AccountOverrideAssumption {
  account: string
  new_value: number
  rationale: string
}

export interface ForecastAssumptions {
  revenue_forecasts: ForecastItemAssumption[]
  ebit_margins: ForecastItemAssumption[]
  ebitda_margins: ForecastItemAssumption[]
  effective_tax_rate: number
  account_overrides: AccountOverrideAssumption[]
  revenue_thesis: string
  margin_thesis: string
  key_assumptions: string[]
}

export interface Assumptions {
  dcf: DCFAssumptions
  wacc: WACCAssumptions
  ddm: DDMAssumptions
  comps: CompsAssumptions
  scenarios: ScenarioAssumptions
  forecast: ForecastAssumptions
  investment_thesis: string
  key_risks: string[]
}
