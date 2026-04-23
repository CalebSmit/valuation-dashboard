/**
 * Pure financial math functions.
 * All functions are deterministic, no side effects.
 */

export interface WACCInputs {
  riskFreeRate: number
  beta: number
  equityRiskPremium: number
  sizePremium: number
  costOfDebt: number
  taxRate: number
  debtWeight: number
  equityWeight: number
}

export function computeCAPM(
  riskFreeRate: number,
  beta: number,
  equityRiskPremium: number,
  sizePremium: number,
): number {
  return riskFreeRate + beta * equityRiskPremium + sizePremium
}

export function computeWACC(inputs: WACCInputs): number {
  const costOfEquity = computeCAPM(
    inputs.riskFreeRate,
    inputs.beta,
    inputs.equityRiskPremium,
    inputs.sizePremium,
  )
  const afterTaxCostOfDebt = inputs.costOfDebt * (1 - inputs.taxRate)
  return inputs.equityWeight * costOfEquity + inputs.debtWeight * afterTaxCostOfDebt
}

export function computeNPV(cashFlows: number[], discountRate: number): number {
  return cashFlows.reduce((npv, cf, i) => {
    return npv + cf / Math.pow(1 + discountRate, i + 1)
  }, 0)
}

export function terminalValueGordonGrowth(
  finalYearFCF: number,
  longTermGrowthRate: number,
  wacc: number,
): number | null {
  if (longTermGrowthRate >= wacc) {
    return null
  }
  if (wacc <= 0) {
    return null
  }
  return (finalYearFCF * (1 + longTermGrowthRate)) / (wacc - longTermGrowthRate)
}

export function terminalValueExitMultiple(
  finalYearEBITDA: number,
  exitMultiple: number,
): number {
  return finalYearEBITDA * exitMultiple
}

export function discountToPresent(
  futureValue: number,
  discountRate: number,
  periods: number,
): number {
  if (periods <= 0) return futureValue
  return futureValue / Math.pow(1 + discountRate, periods)
}

export function computeROIC(
  operatingIncome: number | null,
  taxRate: number,
  totalDebt: number | null,
  totalEquity: number | null,
  totalCash: number | null,
): number | null {
  if (operatingIncome === null || totalDebt === null || totalEquity === null || totalCash === null) {
    return null
  }

  const investedCapital = totalDebt + totalEquity - totalCash
  if (!Number.isFinite(investedCapital) || investedCapital <= 0) {
    return null
  }

  const nopat = operatingIncome * (1 - taxRate)
  return nopat / investedCapital
}

export function computeGeometricMean(returns: number[]): number {
  if (returns.length === 0) return 0
  const product = returns.reduce((acc, r) => acc * (1 + r), 1)
  if (product <= 0) return -1
  return Math.pow(product, 1 / returns.length) - 1
}

export function annualizeReturn(totalReturn: number, years: number): number {
  if (years <= 0) return 0
  return Math.pow(1 + totalReturn, 1 / years) - 1
}

export function median(values: number[]): number | null {
  const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v))
  if (valid.length === 0) return null
  const sorted = [...valid].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}
