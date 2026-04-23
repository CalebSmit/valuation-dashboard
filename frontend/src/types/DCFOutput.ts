export interface FCFProjection {
  year: number
  revenue: number
  revenueGrowth: number
  ebitda: number
  ebitdaMargin: number
  capex: number
  nwcChange: number
  taxes: number
  freeCashFlow: number
  discountFactor: number
  pvFCF: number
}

export interface DCFOutput {
  wacc: number
  costOfEquity: number
  afterTaxCostOfDebt: number
  projections: FCFProjection[]
  terminalValueGordon: number | null
  terminalValueExitMultiple: number | null
  pvTerminalGordon: number | null
  pvTerminalExitMultiple: number | null
  pvFCFTotal: number
  enterpriseValueGordon: number | null
  enterpriseValueExitMultiple: number | null
  netDebt: number
  equityValueGordon: number | null
  equityValueExitMultiple: number | null
  impliedPriceGordon: number | null
  impliedPriceExitMultiple: number | null
  impliedPrice: number | null
  sharesOutstanding: number
  sensitivityMatrix: number[][]
  sensitivityWACCRange: number[]
  sensitivityTerminalRange: number[]
}
