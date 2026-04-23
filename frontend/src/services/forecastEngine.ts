/**
 * 3-Statement Forecast Engine.
 * Generates linked Income Statement, Balance Sheet, and Cash Flow projections.
 * Pure functions — no side effects, fully testable.
 *
 * AI owns: Revenue, EBIT/EBITDA margins, Net Income (via tax rate).
 * Python presets own: Working capital days, CapEx, D&A, debt schedule, SBC.
 * User can override anything.
 */
import type {
  ForecastOutput,
  ForecastValidation,
  PresetAssumptions,
  BaseYearData,
} from '../types/ForecastOutput.ts'
import type { ForecastAssumptions } from '../types/Assumptions.ts'
import { PROJECTION_YEARS } from '../utils/constants.ts'

function safeDiv(num: number, den: number, fallback: number = 0): number {
  return Math.abs(den) < 1e-9 ? fallback : num / den
}

function getYearVal(val: number | number[], yearIdx: number, fallback: number): number {
  if (Array.isArray(val)) return yearIdx < val.length ? val[yearIdx] : fallback
  return val
}

interface MergedAssumptions {
  revenue_growth_rates: number[]
  ebit_margin: number | number[]
  ebitda_margin: number | number[]
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

function mergeAssumptions(
  presets: PresetAssumptions,
  aiForecasts: ForecastAssumptions | null,
  userOverrides: Record<string, number>,
): MergedAssumptions {
  const merged: MergedAssumptions = { ...presets }
  const aiRevenueForecasts = Array.isArray(aiForecasts?.revenue_forecasts) ? aiForecasts.revenue_forecasts : []
  const aiEbitMargins = Array.isArray(aiForecasts?.ebit_margins) ? aiForecasts.ebit_margins : []
  const aiEbitdaMargins = Array.isArray(aiForecasts?.ebitda_margins) ? aiForecasts.ebitda_margins : []
  const aiAccountOverrides = Array.isArray(aiForecasts?.account_overrides) ? aiForecasts.account_overrides : []

  // Apply AI forecasts (revenue as growth rates, margins as per-year arrays)
  if (aiForecasts && aiRevenueForecasts.length === PROJECTION_YEARS) {
    // AI provides absolute revenue — we don't need to convert here,
    // but the engine uses growth rates internally. We'll store the AI absolute
    // values separately and compute growth rates from them.
    // For now, keep preset growth rates as default, the engine will use AI absolute values directly.
    merged.effective_tax_rate = aiForecasts.effective_tax_rate
  }

  if (aiForecasts && aiEbitMargins.length === PROJECTION_YEARS) {
    merged.ebit_margin = aiEbitMargins
      .sort((a, b) => a.year - b.year)
      .map(m => m.value)
  }

  if (aiForecasts && aiEbitdaMargins.length === PROJECTION_YEARS) {
    merged.ebitda_margin = aiEbitdaMargins
      .sort((a, b) => a.year - b.year)
      .map(m => m.value)
  }

  // Apply AI account overrides
  if (aiForecasts) {
    for (const override of aiAccountOverrides) {
      if (override.account in merged) {
        ;(merged as unknown as Record<string, unknown>)[override.account] = override.new_value
      }
    }
  }

  // Apply user overrides (highest priority)
  for (const [key, val] of Object.entries(userOverrides)) {
    // Handle per-year overrides: "ebit_margin_y1" -> ebit_margin[0]
    const yearMatch = key.match(/^(ebit_margin|ebitda_margin|revenue_growth_rates)_y(\d+)$/)
    if (yearMatch) {
      const field = yearMatch[1] as keyof MergedAssumptions
      const yearIdx = parseInt(yearMatch[2]) - 1
      const current = merged[field]
      if (Array.isArray(current)) {
        const copy = [...current]
        copy[yearIdx] = val
        ;(merged as unknown as Record<string, unknown>)[field] = copy
      }
      continue
    }

    if (key in merged) {
      ;(merged as unknown as Record<string, unknown>)[key] = val
    }
  }

  return merged
}

export function computeForecast(
  baseYear: BaseYearData,
  presets: PresetAssumptions,
  aiForecasts: ForecastAssumptions | null,
  userOverrides: Record<string, number>,
): ForecastOutput {
  if (baseYear.total_revenue <= 0) {
    return {
      statements: { incomeStatement: {}, balanceSheet: {}, cashFlow: {}, dcfInputs: {} },
      mergedPresets: presets as unknown as PresetAssumptions,
      aiForecasts,
      validation: { balanced: false, maxDiff: 0, issues: ['Base year revenue is zero or negative'] },
      revenues: [],
    }
  }

  const assumptions = mergeAssumptions(presets, aiForecasts, userOverrides)
  const aiRevenueForecasts = Array.isArray(aiForecasts?.revenue_forecasts) ? aiForecasts.revenue_forecasts : []

  // Determine revenue projection method: AI absolute values or growth rates
  const useAIRevenue = aiForecasts !== null
    && aiRevenueForecasts.length === PROJECTION_YEARS
    && !Object.keys(userOverrides).some(k => k.startsWith('revenue_growth_rates'))
  const aiRevenues = useAIRevenue
    ? [...aiRevenueForecasts].sort((a, b) => a.year - b.year).map(r => r.value)
    : null

  const YEARS = PROJECTION_YEARS

  // Statement data: index 0 = base year, 1..5 = Y1..Y5
  const is: Record<string, number[]> = {}
  const bs: Record<string, number[]> = {}
  const cf: Record<string, number[]> = {}

  const isAccounts = [
    'Total Revenue', 'Cost of Revenue', 'Gross Profit',
    'R&D Expense', 'SG&A Expense',
    'Operating Income (EBIT)', 'D&A', 'EBITDA',
    'Interest Expense', 'Pre-Tax Income', 'Tax Provision',
    'Net Income', 'EPS (Diluted)',
  ]
  const bsAccounts = [
    'Cash & Equivalents', 'Accounts Receivable', 'Inventories',
    'Other Current Assets', 'Total Current Assets',
    'PP&E (Net)', 'Goodwill & Intangibles', 'Other Non-Current Assets',
    'Total Assets',
    'Accounts Payable', 'Current Debt', 'Other Current Liabilities',
    'Total Current Liabilities',
    'Long-Term Debt', 'Other Non-Current Liabilities', 'Total Liabilities',
    'Stockholders\' Equity', 'Total Liabilities & Equity',
  ]
  const cfAccounts = [
    'Net Income', 'D&A', 'Stock-Based Compensation',
    'Changes in Working Capital', 'Operating Cash Flow',
    'Capital Expenditure', 'Investing Cash Flow',
    'Debt Issuance / (Repayment)', 'Dividends Paid', 'Share Repurchases',
    'Financing Cash Flow',
    'Free Cash Flow', 'Ending Cash Balance',
  ]

  for (const a of isAccounts) is[a] = []
  for (const a of bsAccounts) bs[a] = []
  for (const a of cfAccounts) cf[a] = []

  // Base year
  is['Total Revenue'].push(baseYear.total_revenue)
  is['Cost of Revenue'].push(baseYear.cost_of_revenue)
  is['Gross Profit'].push(baseYear.gross_profit)
  is['R&D Expense'].push(baseYear.rnd_expense)
  is['SG&A Expense'].push(baseYear.sga_expense)
  is['Operating Income (EBIT)'].push(baseYear.ebit)
  is['D&A'].push(baseYear.da)
  is['EBITDA'].push(baseYear.ebitda)
  is['Interest Expense'].push(baseYear.interest_expense)
  is['Pre-Tax Income'].push(baseYear.pretax_income)
  is['Tax Provision'].push(baseYear.tax_provision)
  is['Net Income'].push(baseYear.net_income)
  is['EPS (Diluted)'].push(safeDiv(baseYear.net_income, baseYear.diluted_shares))

  bs['Cash & Equivalents'].push(baseYear.cash)
  bs['Accounts Receivable'].push(baseYear.accounts_receivable)
  bs['Inventories'].push(baseYear.inventories)
  bs['Other Current Assets'].push(baseYear.other_current_assets)
  bs['Total Current Assets'].push(baseYear.total_current_assets)
  bs['PP&E (Net)'].push(baseYear.ppe_net)
  bs['Goodwill & Intangibles'].push(baseYear.goodwill)
  bs['Other Non-Current Assets'].push(baseYear.other_noncurrent_assets)
  bs['Total Assets'].push(baseYear.total_assets)
  bs['Accounts Payable'].push(baseYear.accounts_payable)
  bs['Current Debt'].push(baseYear.current_debt)
  bs['Other Current Liabilities'].push(baseYear.other_current_liabilities)
  bs['Total Current Liabilities'].push(baseYear.total_current_liabilities)
  bs['Long-Term Debt'].push(baseYear.long_term_debt)
  bs['Other Non-Current Liabilities'].push(baseYear.other_noncurrent_liabilities ?? 0)
  bs['Total Liabilities'].push(baseYear.total_liabilities)
  bs['Stockholders\' Equity'].push(baseYear.stockholders_equity)
  bs['Total Liabilities & Equity'].push(baseYear.total_liabilities + baseYear.stockholders_equity)

  cf['Net Income'].push(baseYear.net_income)
  cf['D&A'].push(baseYear.da)
  cf['Stock-Based Compensation'].push(baseYear.sbc)
  cf['Changes in Working Capital'].push(0)
  cf['Operating Cash Flow'].push(baseYear.operating_cf)
  cf['Capital Expenditure'].push(-baseYear.capex)
  cf['Investing Cash Flow'].push(-baseYear.capex)
  cf['Debt Issuance / (Repayment)'].push(0)
  cf['Dividends Paid'].push(-baseYear.dividends_paid)
  cf['Share Repurchases'].push(-baseYear.repurchases)
  cf['Financing Cash Flow'].push(-baseYear.dividends_paid - baseYear.repurchases)
  cf['Free Cash Flow'].push(baseYear.fcf)
  cf['Ending Cash Balance'].push(baseYear.cash)

  // Rolling state
  let prevRevenue = baseYear.total_revenue
  let prevPpe = baseYear.ppe_net
  let prevAr = baseYear.accounts_receivable
  let prevInv = baseYear.inventories
  let prevAp = baseYear.accounts_payable
  let prevOca = baseYear.other_current_assets
  let prevOcl = baseYear.other_current_liabilities
  let prevLtDebt = baseYear.long_term_debt
  let prevCurrentDebt = baseYear.current_debt
  let prevEquity = baseYear.stockholders_equity
  const goodwill = baseYear.goodwill
  const otherNca = baseYear.other_noncurrent_assets
  const otherNcl = baseYear.other_noncurrent_liabilities ?? 0
  const dilutedShares = baseYear.diluted_shares > 0 ? baseYear.diluted_shares : 1
  const issues: string[] = []

  for (let yr = 0; yr < YEARS; yr++) {
    // Revenue: AI absolute or growth-rate based
    let revenue: number
    if (aiRevenues && !Object.keys(userOverrides).some(k => k === `revenue_growth_rates_y${yr + 1}`)) {
      revenue = aiRevenues[yr]
    } else {
      const g = getYearVal(assumptions.revenue_growth_rates, yr, 0.03)
      revenue = prevRevenue * (1 + g)
    }

    const em = getYearVal(assumptions.ebit_margin, yr, 0.15)
    const ebm = getYearVal(assumptions.ebitda_margin, yr, 0.20)

    // Income Statement
    const ebitVal = revenue * em
    const ebitdaVal = revenue * ebm
    const daVal = prevPpe * assumptions.da_pct_ppe
    const rndVal = revenue * assumptions.rnd_pct_revenue
    const sgaVal = revenue * assumptions.sga_pct_revenue
    const cogsVal = revenue * assumptions.cogs_pct_revenue
    const grossProfit = revenue - cogsVal

    const totalPriorDebt = prevLtDebt + prevCurrentDebt
    const interestVal = totalPriorDebt * assumptions.cost_of_debt
    const pretax = ebitVal - interestVal
    const taxVal = pretax > 0 ? Math.max(pretax * assumptions.effective_tax_rate, 0) : 0
    const netIncome = pretax - taxVal
    const eps = safeDiv(netIncome, dilutedShares)

    is['Total Revenue'].push(revenue)
    is['Cost of Revenue'].push(cogsVal)
    is['Gross Profit'].push(grossProfit)
    is['R&D Expense'].push(rndVal)
    is['SG&A Expense'].push(sgaVal)
    is['Operating Income (EBIT)'].push(ebitVal)
    is['D&A'].push(daVal)
    is['EBITDA'].push(ebitdaVal)
    is['Interest Expense'].push(interestVal)
    is['Pre-Tax Income'].push(pretax)
    is['Tax Provision'].push(taxVal)
    is['Net Income'].push(netIncome)
    is['EPS (Diluted)'].push(eps)

    // Balance Sheet
    const capexVal = revenue * assumptions.capex_pct_revenue
    const ppeNew = prevPpe + capexVal - daVal
    const arNew = revenue * assumptions.dso_days / 365
    const invNew = Math.abs(cogsVal) * assumptions.dio_days / 365
    const apNew = Math.abs(cogsVal) * assumptions.dpo_days / 365
    const ocaNew = revenue * assumptions.other_ca_pct_revenue
    const oclNew = revenue * assumptions.other_cl_pct_revenue

    const newCurrentDebt = Math.max(prevCurrentDebt - assumptions.debt_repayment_annual, 0)
    let newLtDebt = prevLtDebt + assumptions.new_debt_issuance - assumptions.debt_repayment_annual
    if (newLtDebt < 0) {
      issues.push(`Y${yr + 1}: Long-term debt schedule implies negative debt; clamped to 0`)
      newLtDebt = 0
    }

    const dividendsVal = netIncome > 0 ? Math.abs(netIncome) * assumptions.dividend_payout_ratio : 0
    const repurchase = assumptions.share_repurchase_annual
    const newEquity = prevEquity + netIncome - dividendsVal - repurchase

    const totalCl = apNew + newCurrentDebt + oclNew
    const totalNcl = newLtDebt + otherNcl
    const totalLiab = totalCl + totalNcl
    const totalCaExCash = arNew + invNew + ocaNew
    const totalNca = ppeNew + goodwill + otherNca

    // Cash is the plug
    const cashPlug = (totalLiab + newEquity) - totalCaExCash - totalNca
    const totalCa = cashPlug + totalCaExCash
    const totalAssets = totalCa + totalNca
    const totalLe = totalLiab + newEquity

    bs['Cash & Equivalents'].push(cashPlug)
    bs['Accounts Receivable'].push(arNew)
    bs['Inventories'].push(invNew)
    bs['Other Current Assets'].push(ocaNew)
    bs['Total Current Assets'].push(totalCa)
    bs['PP&E (Net)'].push(ppeNew)
    bs['Goodwill & Intangibles'].push(goodwill)
    bs['Other Non-Current Assets'].push(otherNca)
    bs['Total Assets'].push(totalAssets)
    bs['Accounts Payable'].push(apNew)
    bs['Current Debt'].push(newCurrentDebt)
    bs['Other Current Liabilities'].push(oclNew)
    bs['Total Current Liabilities'].push(totalCl)
    bs['Long-Term Debt'].push(newLtDebt)
    bs['Other Non-Current Liabilities'].push(otherNcl)
    bs['Total Liabilities'].push(totalLiab)
    bs['Stockholders\' Equity'].push(newEquity)
    bs['Total Liabilities & Equity'].push(totalLe)

    // Cash Flow
    const sbcVal = revenue * assumptions.sbc_pct_revenue
    const deltaAr = arNew - prevAr
    const deltaInv = invNew - prevInv
    const deltaAp = apNew - prevAp
    const deltaOca = ocaNew - prevOca
    const deltaOcl = oclNew - prevOcl
    const wcChange = -(deltaAr + deltaInv + deltaOca) + (deltaAp + deltaOcl)

    const operatingCf = netIncome + daVal + sbcVal + wcChange
    const investingCf = -capexVal
    const debtNet = assumptions.new_debt_issuance - assumptions.debt_repayment_annual
    const financingCf = debtNet - dividendsVal - repurchase
    const fcfVal = operatingCf - capexVal
    const endingCash = cashPlug

    cf['Net Income'].push(netIncome)
    cf['D&A'].push(daVal)
    cf['Stock-Based Compensation'].push(sbcVal)
    cf['Changes in Working Capital'].push(wcChange)
    cf['Operating Cash Flow'].push(operatingCf)
    cf['Capital Expenditure'].push(-capexVal)
    cf['Investing Cash Flow'].push(investingCf)
    cf['Debt Issuance / (Repayment)'].push(debtNet)
    cf['Dividends Paid'].push(-dividendsVal)
    cf['Share Repurchases'].push(-repurchase)
    cf['Financing Cash Flow'].push(financingCf)
    cf['Free Cash Flow'].push(fcfVal)
    cf['Ending Cash Balance'].push(endingCash)

    // Roll forward
    prevRevenue = revenue
    prevPpe = ppeNew
    prevAr = arNew
    prevInv = invNew
    prevAp = apNew
    prevOca = ocaNew
    prevOcl = oclNew
    prevLtDebt = newLtDebt
    prevCurrentDebt = newCurrentDebt
    prevEquity = newEquity
    void endingCash // prevCash tracking removed (unused)
  }

  // Extract DCF Inputs
  const dcfInputs: Record<string, number[]> = {
    'Revenue': [], 'EBITDA': [], 'EBIT': [], 'D&A': [],
    'CapEx': [], 'Change in NWC': [], 'Taxes (on EBIT)': [],
    'UFCF': [], 'FCFE': [],
  }

  let prevNwc: number | null = null
  for (let yr = 0; yr < YEARS; yr++) {
    const idx = yr + 1 // skip base year
    const revenue = is['Total Revenue'][idx]
    const ebitda = is['EBITDA'][idx]
    const ebit = is['Operating Income (EBIT)'][idx]
    const da = is['D&A'][idx]
    const capex = Math.abs(cf['Capital Expenditure'][idx])
    const ni = is['Net Income'][idx]

    const ar = bs['Accounts Receivable'][idx]
    const inv = bs['Inventories'][idx]
    const oca = bs['Other Current Assets'][idx]
    const ap = bs['Accounts Payable'][idx]
    const ocl = bs['Other Current Liabilities'][idx]
    const nwc = (ar + inv + oca) - (ap + ocl)

    if (prevNwc === null) {
      const baseAr = bs['Accounts Receivable'][0]
      const baseInv = bs['Inventories'][0]
      const baseOca = bs['Other Current Assets'][0]
      const baseAp = bs['Accounts Payable'][0]
      const baseOcl = bs['Other Current Liabilities'][0]
      prevNwc = (baseAr + baseInv + baseOca) - (baseAp + baseOcl)
    }

    const deltaNwc = nwc - prevNwc
    const taxesOnEbit = Math.max(ebit * assumptions.effective_tax_rate, 0)
    const ufcf = ebit * (1 - assumptions.effective_tax_rate) + da - capex - deltaNwc
    const fcfe = ni + da - capex - deltaNwc

    dcfInputs['Revenue'].push(revenue)
    dcfInputs['EBITDA'].push(ebitda)
    dcfInputs['EBIT'].push(ebit)
    dcfInputs['D&A'].push(da)
    dcfInputs['CapEx'].push(capex)
    dcfInputs['Change in NWC'].push(deltaNwc)
    dcfInputs['Taxes (on EBIT)'].push(taxesOnEbit)
    dcfInputs['UFCF'].push(ufcf)
    dcfInputs['FCFE'].push(fcfe)

    prevNwc = nwc
  }

  // Validation
  let maxDiff = 0
  for (let yr = 0; yr < YEARS; yr++) {
    const idx = yr + 1
    const ta = bs['Total Assets'][idx]
    const tle = bs['Total Liabilities & Equity'][idx]
    const diff = Math.abs(ta - tle)
    maxDiff = Math.max(maxDiff, diff)
    if (diff > 1) {
      issues.push(`BS imbalance Y${yr + 1}: Assets=${ta.toFixed(0)}, L&E=${tle.toFixed(0)}`)
    }
  }

  const validation: ForecastValidation = {
    balanced: issues.length === 0,
    maxDiff,
    issues,
  }

  return {
    statements: {
      incomeStatement: is,
      balanceSheet: bs,
      cashFlow: cf,
      dcfInputs,
    },
    mergedPresets: assumptions as unknown as PresetAssumptions,
    aiForecasts,
    validation,
    revenues: is['Total Revenue'].slice(1), // Y1-Y5, excluding base year
  }
}
