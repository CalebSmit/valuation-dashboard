/**
 * DCF (Discounted Cash Flow) calculation engine.
 * Pure functions — no side effects, fully testable.
 */
import type { FinancialData } from '../types/FinancialData.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { DCFOutput, FCFProjection } from '../types/DCFOutput.ts'
import type { DCFConfig } from '../types/ValuationConfig.ts'
import { CashFlowBasis, DiscountingConvention } from '../types/ValuationConfig.ts'
import {
  computeWACC,
  terminalValueGordonGrowth,
  terminalValueExitMultiple,
  discountToPresent,
} from '../utils/financialMath.ts'
import { PROJECTION_YEARS } from '../utils/constants.ts'

function resolveNetBorrowingRate(data: FinancialData): number {
  if (data.netBorrowing !== null && data.capex !== null && Math.abs(data.capex) > 0) {
    return data.netBorrowing / Math.abs(data.capex)
  }
  return 0.20
}

function resolveDaPctOfCapex(data: FinancialData): number {
  const depreciationAndAmortization = data.depreciationAndAmortization
  const capex = data.capex

  if (depreciationAndAmortization === null || capex === null) {
    return 0.85
  }

  const capexBase = Math.abs(capex)
  if (capexBase <= 0) {
    return 0.85
  }

  const ratio = depreciationAndAmortization / capexBase
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0.85
  }

  return Math.min(ratio, 1.5)
}

export function computeDCF(
  data: FinancialData,
  assumptions: Assumptions,
  config?: DCFConfig,
  forecastRevenues?: number[],
): DCFOutput {
  const { dcf, wacc: waccInputs } = assumptions
  const useFCFE = config?.cashFlowBasis === CashFlowBasis.FCFE
  const useMidYear = config?.discountingConvention === DiscountingConvention.MidPeriod
    || dcf.mid_year_convention

  // Compute WACC
  const wacc = computeWACC({
    riskFreeRate: waccInputs.risk_free_rate.value,
    beta: waccInputs.beta.value,
    equityRiskPremium: waccInputs.equity_risk_premium.value,
    sizePremium: waccInputs.size_premium.value,
    costOfDebt: waccInputs.cost_of_debt.value,
    taxRate: waccInputs.tax_rate.value,
    debtWeight: waccInputs.debt_weight.value,
    equityWeight: waccInputs.equity_weight.value,
  })

  const costOfEquity =
    waccInputs.risk_free_rate.value +
    waccInputs.beta.value * waccInputs.equity_risk_premium.value +
    waccInputs.size_premium.value

  const afterTaxCostOfDebt =
    waccInputs.cost_of_debt.value * (1 - waccInputs.tax_rate.value)

  // FCFE uses cost of equity as discount rate; FCFF uses WACC
  const discountRate = useFCFE ? costOfEquity : wacc

  // FCFE data (fallback to FCFF if missing)
  const canUseFCFE = useFCFE && data.interestExpense !== null
  const interestExpense = data.interestExpense ?? 0
  const netBorrowingRate = resolveNetBorrowingRate(data)

  // Base revenue from latest data
  const baseRevenue = data.revenueLatest ?? 0
  // Hard gate on shares outstanding: fall back of 1 used to silently
  // produce $50B-per-share price targets when yfinance returns null
  // (ADRs, post-split edge cases). null/<=0 must propagate as null.
  const rawShares = data.sharesOutstanding
  const sharesOutstanding = rawShares !== null && rawShares !== undefined && rawShares > 0
    ? rawShares
    : null

  const projections: FCFProjection[] = []
  let currentRevenue = baseRevenue

  // Derive growth rates from forecast revenues when available, otherwise use DCF assumptions
  const growthRates: number[] = []
  if (forecastRevenues && forecastRevenues.length >= PROJECTION_YEARS) {
    let prev = baseRevenue
    for (let i = 0; i < PROJECTION_YEARS; i++) {
      growthRates.push(prev > 0 ? (forecastRevenues[i] / prev) - 1 : 0)
      prev = forecastRevenues[i]
    }
  } else {
    growthRates.push(...dcf.revenue_growth_rates.map(r => r.value))
    while (growthRates.length < PROJECTION_YEARS) {
      growthRates.push(growthRates[growthRates.length - 1] ?? 0.03)
    }
  }

  const daPctOfCapex = resolveDaPctOfCapex(data)
  const midYearAdj = useMidYear ? 0.5 : 0

  let previousNWC = baseRevenue * dcf.nwc_pct_revenue.value

  for (let i = 0; i < PROJECTION_YEARS; i++) {
    const growth = growthRates[i]
    const revenue = currentRevenue * (1 + growth)
    const ebitda = revenue * dcf.ebitda_margin.value
    const capex = revenue * dcf.capex_pct_revenue.value
    const da = capex * daPctOfCapex
    const ebit = ebitda - da

    const currentNWC = revenue * dcf.nwc_pct_revenue.value
    const nwcChange = currentNWC - previousNWC

    let fcf: number
    let taxes: number

    if (canUseFCFE) {
      // FCFE = Net Income + D&A - CapEx - ΔNWC + Net Borrowing
      const scaledInterest = interestExpense * (revenue / baseRevenue)
      const netIncome = (ebit - scaledInterest) * (1 - dcf.tax_rate.value)
      const netBorrowing = capex * netBorrowingRate
      fcf = netIncome + da - capex - nwcChange + netBorrowing
      taxes = Math.max(0, (ebit - scaledInterest) * dcf.tax_rate.value)
    } else {
      // UFCF = EBIT*(1-t) + D&A - CapEx - ΔNWC
      taxes = Math.max(0, ebit * dcf.tax_rate.value)
      fcf = ebit * (1 - dcf.tax_rate.value) + da - capex - nwcChange
    }

    const discountFactor = 1 / Math.pow(1 + discountRate, i + 1 - midYearAdj)
    const pvFCF = fcf * discountFactor

    projections.push({
      year: i + 1,
      revenue,
      revenueGrowth: growth,
      ebitda,
      ebitdaMargin: dcf.ebitda_margin.value,
      capex,
      nwcChange,
      taxes,
      freeCashFlow: fcf,
      discountFactor,
      pvFCF,
    })

    currentRevenue = revenue
    previousNWC = currentNWC
  }

  const finalProjection = projections[projections.length - 1]
  const finalFCF = finalProjection?.freeCashFlow ?? 0
  const finalEBITDA = finalProjection?.ebitda ?? 0

  const pvFCFTotal = projections.reduce((sum, p) => sum + p.pvFCF, 0)

  // Terminal value — Gordon Growth method
  const tvGordon = terminalValueGordonGrowth(
    finalFCF,
    dcf.terminal_growth_rate.value,
    discountRate,
  )
  const pvTerminalGordon = tvGordon !== null
    ? discountToPresent(tvGordon, discountRate, PROJECTION_YEARS)
    : null

  // Terminal value — Exit Multiple method
  const tvExitMultiple = terminalValueExitMultiple(finalEBITDA, dcf.exit_multiple.value)
  const pvTerminalExitMultiple = discountToPresent(tvExitMultiple, discountRate, PROJECTION_YEARS)

  // Net debt bridge: FCFF → EV → subtract net debt; FCFE → equity value directly
  const totalDebt = data.totalDebt ?? 0
  const totalCash = data.totalCash ?? 0
  const netDebt = canUseFCFE ? 0 : totalDebt - totalCash

  const evGordon = pvTerminalGordon !== null ? pvFCFTotal + pvTerminalGordon : null
  const evExitMultiple = pvFCFTotal + pvTerminalExitMultiple

  const equityGordon = evGordon !== null ? evGordon - netDebt : null
  const equityExitMultiple = evExitMultiple - netDebt

  const impliedPriceGordon = equityGordon !== null && sharesOutstanding !== null
    ? equityGordon / sharesOutstanding
    : null
  const impliedPriceExitMultiple = sharesOutstanding !== null
    ? equityExitMultiple / sharesOutstanding
    : null

  // Blended implied price: Exit Multiple 60%, Gordon 40%
  let impliedPrice: number | null = null
  if (impliedPriceGordon !== null && impliedPriceExitMultiple !== null) {
    impliedPrice = impliedPriceGordon * 0.40 + impliedPriceExitMultiple * 0.60
  } else {
    impliedPrice = impliedPriceGordon ?? impliedPriceExitMultiple
  }

  // Sensitivity matrix
  const waccRange = [-0.02, -0.01, 0, 0.01, 0.02].map(d => wacc + d)
  const terminalRange = [-2, -1, 0, 1, 2].map(d => dcf.exit_multiple.value + d)
  const sensitivityMatrix = buildSensitivityMatrix(
    data,
    assumptions,
    waccRange,
    terminalRange,
  )

  return {
    wacc,
    costOfEquity,
    afterTaxCostOfDebt,
    projections,
    terminalValueGordon: tvGordon,
    terminalValueExitMultiple: tvExitMultiple,
    pvTerminalGordon,
    pvTerminalExitMultiple,
    pvFCFTotal,
    enterpriseValueGordon: evGordon,
    enterpriseValueExitMultiple: evExitMultiple,
    netDebt: totalDebt - totalCash,
    equityValueGordon: equityGordon,
    equityValueExitMultiple: equityExitMultiple,
    impliedPriceGordon,
    impliedPriceExitMultiple,
    impliedPrice,
    sharesOutstanding,
    sensitivityMatrix,
    sensitivityWACCRange: waccRange,
    sensitivityTerminalRange: terminalRange,
    ...(sharesOutstanding === null
      ? { warning: 'Shares outstanding unavailable for this ticker — implied price cannot be calculated.' }
      : {}),
  }
}

export function buildSensitivityMatrix(
  data: FinancialData,
  assumptions: Assumptions,
  waccRange: number[],
  terminalRange: number[],
): number[][] {
  const { dcf } = assumptions
  const baseRevenue = data.revenueLatest ?? 0
  const rawShares = data.sharesOutstanding
  const sharesOutstanding = rawShares !== null && rawShares !== undefined && rawShares > 0
    ? rawShares
    : 0
  const netDebt = (data.totalDebt ?? 0) - (data.totalCash ?? 0)

  const growthRates = dcf.revenue_growth_rates.map(r => r.value)
  while (growthRates.length < PROJECTION_YEARS) {
    growthRates.push(growthRates[growthRates.length - 1] ?? 0.03)
  }

  const daPctOfCapex = resolveDaPctOfCapex(data)
  const midYearAdj = dcf.mid_year_convention ? 0.5 : 0

  return waccRange.map(w => {
    return terminalRange.map(exitMult => {
      if (w <= 0) return 0

      let revenue = baseRevenue
      let pvFCFTotal = 0
      let lastEBITDA = 0
      let prevNWC = baseRevenue * dcf.nwc_pct_revenue.value

      for (let i = 0; i < PROJECTION_YEARS; i++) {
        revenue = revenue * (1 + growthRates[i])
        const ebitda = revenue * dcf.ebitda_margin.value
        const capex = revenue * dcf.capex_pct_revenue.value
        const da = capex * daPctOfCapex
        const ebit = ebitda - da
        const curNWC = revenue * dcf.nwc_pct_revenue.value
        const nwcChange = curNWC - prevNWC
        const fcf = ebit * (1 - dcf.tax_rate.value) + da - capex - nwcChange
        pvFCFTotal += fcf / Math.pow(1 + w, i + 1 - midYearAdj)
        lastEBITDA = ebitda
        prevNWC = curNWC
      }

      const tv = lastEBITDA * exitMult
      const pvTV = tv / Math.pow(1 + w, PROJECTION_YEARS)
      const ev = pvFCFTotal + pvTV
      const equity = ev - netDebt

      return sharesOutstanding > 0 ? equity / sharesOutstanding : 0
    })
  })
}
