/**
 * DDM (Dividend Discount Model) calculation engine.
 *
 * CFA methodology: the DDM produces a price for any company with a positive DPS
 * and ke > g. The applicability criteria (dividend history, payout ratio, positive
 * earnings) are advisory — they inform the analyst's confidence, not gate the
 * computation. Model weights express the analyst's judgment on how much to trust DDM.
 */
import type { FinancialData } from '../types/FinancialData.ts'
import type { DDMAssumptions, WACCAssumptions } from '../types/Assumptions.ts'
import type { DDMOutput, DDMApplicabilityCriterion, DPSProjection } from '../types/DDMOutput.ts'

export function checkDDMApplicability(data: FinancialData): {
  isApplicable: boolean
  criteria: DDMApplicabilityCriterion[]
  score: number
} {
  const criteria: DDMApplicabilityCriterion[] = []

  // Criterion 1: Company pays dividends
  const paysDividends = (data.dividendYield ?? 0) > 0 || (data.annualDividendRate ?? 0) > 0
  criteria.push({
    name: 'Pays dividends',
    pass: paysDividends,
    detail: paysDividends
      ? `Dividend yield: ${((data.dividendYield ?? 0) * 100).toFixed(2)}%`
      : 'Company does not pay dividends',
  })

  // Criterion 2: Consistent dividend history (CFA standard: 5+ years)
  const hasHistory = (data.yearsOfDividendHistory ?? 0) >= 5
  criteria.push({
    name: 'Consistent dividend history (5+ years)',
    pass: hasHistory,
    detail: hasHistory
      ? `${data.yearsOfDividendHistory} years of dividend payments`
      : `Only ${data.yearsOfDividendHistory ?? 0} years of history (need 5+)`,
  })

  // Criterion 3: Sustainable payout ratio (CFA standard: 20-80%)
  const payoutRatio = data.payoutRatio ?? 0
  const sustainablePayout = payoutRatio >= 0.20 && payoutRatio <= 0.80
  criteria.push({
    name: 'Sustainable payout ratio (20-80%)',
    pass: sustainablePayout,
    detail: sustainablePayout
      ? `Payout ratio: ${(payoutRatio * 100).toFixed(1)}%`
      : `Payout ratio: ${payoutRatio > 0 ? (payoutRatio * 100).toFixed(1) + '% (outside 20-80% range)' : 'N/A'}`,
  })

  // Criterion 4: Positive earnings
  const positiveEarnings = (data.peRatioTTM ?? 0) > 0
  criteria.push({
    name: 'Positive earnings',
    pass: positiveEarnings,
    detail: positiveEarnings
      ? `P/E ratio: ${data.peRatioTTM?.toFixed(1)}`
      : 'Negative or zero earnings',
  })

  const score = criteria.filter(c => c.pass).length
  // Advisory: high confidence when pays dividends + 5yr history + score >= 3
  // But isApplicable is now just "can we compute at all" = pays dividends with DPS > 0
  const isApplicable = paysDividends && (data.annualDividendRate ?? 0) > 0

  return { isApplicable, criteria, score }
}

/**
 * Derive the CAPM cost of equity from WACC assumptions for use as fallback ke.
 */
function deriveCostOfEquity(wacc: WACCAssumptions): number {
  const rf = wacc.risk_free_rate.value
  const beta = wacc.beta.value
  const erp = wacc.equity_risk_premium.value
  const sizePremium = wacc.size_premium.value
  return rf + beta * erp + sizePremium
}

export function computeDDM(
  data: FinancialData,
  assumptions: DDMAssumptions,
  wacc?: WACCAssumptions,
): DDMOutput {
  const applicability = checkDDMApplicability(data)

  // Hard gate: no dividends, zero DPS, or AI explicitly marked not applicable
  if (!applicability.isApplicable || assumptions.is_applicable === false) {
    return {
      isApplicable: false,
      applicabilityCriteria: applicability.criteria,
      applicabilityScore: applicability.score,
      singleStagePrice: null,
      twoStagePrice: null,
      impliedPrice: null,
      currentDPS: null,
      requiredReturn: null,
      shortTermGrowth: null,
      longTermGrowth: null,
      dpsProjections: [],
    }
  }

  // Derive assumptions — use AI values when available, fall back to data-derived defaults
  const currentDPS = data.annualDividendRate ?? 0
  const fallbackKe = wacc ? deriveCostOfEquity(wacc) : 0.10
  const requiredReturn = assumptions.required_return?.value ?? fallbackKe
  const shortTermGrowth = assumptions.short_term_growth_rate?.value
    ?? data.dividendGrowth5yr ?? data.dividendGrowth3yr ?? 0.03
  const longTermGrowth = assumptions.long_term_growth_rate?.value ?? 0.025
  const highGrowthYears = assumptions.high_growth_years ?? 5

  // Single-stage DDM: P = D1 / (ke - g)
  let singleStagePrice: number | null = null
  if (requiredReturn > longTermGrowth && currentDPS > 0) {
    const d1 = currentDPS * (1 + longTermGrowth)
    singleStagePrice = d1 / (requiredReturn - longTermGrowth)
  }

  // Two-stage DDM
  let twoStagePrice: number | null = null
  const dpsProjections: DPSProjection[] = []

  if (currentDPS > 0 && requiredReturn > longTermGrowth) {
    let pvSum = 0
    let lastDPS = currentDPS

    // High growth phase
    for (let i = 1; i <= highGrowthYears; i++) {
      const growthRate = shortTermGrowth
      const dps = lastDPS * (1 + growthRate)
      const pv = dps / Math.pow(1 + requiredReturn, i)
      pvSum += pv

      dpsProjections.push({
        year: i,
        dps,
        growthRate,
        pvDPS: pv,
      })

      lastDPS = dps
    }

    // Terminal value at end of high growth phase
    const terminalDPS = lastDPS * (1 + longTermGrowth)
    const terminalValue = terminalDPS / (requiredReturn - longTermGrowth)
    const pvTerminal = terminalValue / Math.pow(1 + requiredReturn, highGrowthYears)

    twoStagePrice = pvSum + pvTerminal
  }

  // Use two-stage as primary, single-stage as fallback
  const impliedPrice = twoStagePrice ?? singleStagePrice

  return {
    isApplicable: true,
    applicabilityCriteria: applicability.criteria,
    applicabilityScore: applicability.score,
    singleStagePrice,
    twoStagePrice,
    impliedPrice,
    currentDPS,
    requiredReturn,
    shortTermGrowth,
    longTermGrowth,
    dpsProjections,
  }
}
