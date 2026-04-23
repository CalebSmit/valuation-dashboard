import { describe, it, expect } from 'vitest'
import { checkDDMApplicability, computeDDM } from '../src/services/ddmEngine.ts'
import type { FinancialData } from '../src/types/FinancialData.ts'
import type { DDMAssumptions } from '../src/types/Assumptions.ts'

function makeDividendPayer(): FinancialData {
  return {
    ticker: 'DIV', companyName: 'Dividend Corp', sector: 'Utilities',
    industry: 'Electric', businessSummary: '', currentPrice: 50,
    sharesOutstanding: 500_000_000, marketCap: 25_000_000_000,
    enterpriseValue: 30_000_000_000, peRatioTTM: 15, forwardPE: 14,
    pbRatio: 2, evToEbitda: 10, evToRevenue: 3, profitMargin: 0.15,
    operatingMargin: 0.25, roe: 0.12, roa: 0.06, debtToEquity: 0.8,
    currentRatio: 1.2, beta: 0.6, fiftyTwoWeekHigh: 55, fiftyTwoWeekLow: 40,
    revenueHistory: [], ebitdaHistory: [], revenueLatest: 8_000_000_000,
    operatingIncome: 2_000_000_000, totalDebt: 10_000_000_000,
    totalCash: 2_000_000_000, totalEquity: 12_000_000_000,
    operatingCashFlow: 3_000_000_000, capex: 1_000_000_000,
    freeCashFlow: 2_000_000_000,
    dividendYield: 0.04, annualDividendRate: 2.0, payoutRatio: 0.6,
    dividendGrowth5yr: 0.05, dividendGrowth3yr: 0.06,
    yearsOfDividendHistory: 15, paymentFrequency: 'Quarterly',
    regressionBeta: 0.6, betaRSquared: 0.4, betaStdError: 0.1,
    riskFreeRate10yr: 0.04, riskFreeRate5yr: 0.038, fedFundsRate: 0.05,
    cpi: 300, vix: 18, realGDPGrowth: 2.5,
    competitors: [], analystTargetMean: 55, analystTargetLow: 45, analystTargetHigh: 65,
  }
}

function makeNonDividendPayer(): FinancialData {
  return {
    ...makeDividendPayer(),
    ticker: 'NDIV', companyName: 'Growth Corp',
    dividendYield: 0, annualDividendRate: 0, payoutRatio: 0,
    yearsOfDividendHistory: 0, paymentFrequency: 'None',
  }
}

describe('checkDDMApplicability', () => {
  it('passes for a dividend-paying company', () => {
    const result = checkDDMApplicability(makeDividendPayer())
    expect(result.isApplicable).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(3)
  })

  it('fails for a non-dividend payer', () => {
    const result = checkDDMApplicability(makeNonDividendPayer())
    expect(result.isApplicable).toBe(false)
    expect(result.criteria[0].pass).toBe(false)
  })

  it('returns 4 criteria', () => {
    const result = checkDDMApplicability(makeDividendPayer())
    expect(result.criteria).toHaveLength(4)
  })
})

describe('computeDDM', () => {
  const ddmAssumptions: DDMAssumptions = {
    is_applicable: true,
    applicability_reason: 'Stable dividend payer',
    short_term_growth_rate: { value: 0.05, source: 'test', confidence: 'medium', rationale: '' },
    long_term_growth_rate: { value: 0.025, source: 'test', confidence: 'medium', rationale: '' },
    required_return: { value: 0.10, source: 'test', confidence: 'medium', rationale: '' },
    high_growth_years: 5,
  }

  it('computes single-stage price for dividend payer', () => {
    const result = computeDDM(makeDividendPayer(), ddmAssumptions)
    expect(result.isApplicable).toBe(true)
    expect(result.singleStagePrice).not.toBeNull()
    expect(result.singleStagePrice!).toBeGreaterThan(0)
  })

  it('computes two-stage price for dividend payer', () => {
    const result = computeDDM(makeDividendPayer(), ddmAssumptions)
    expect(result.twoStagePrice).not.toBeNull()
    expect(result.twoStagePrice!).toBeGreaterThan(0)
  })

  it('two-stage price differs from single-stage', () => {
    const result = computeDDM(makeDividendPayer(), ddmAssumptions)
    expect(result.twoStagePrice).not.toEqual(result.singleStagePrice)
  })

  it('produces DPS projections for high-growth years', () => {
    const result = computeDDM(makeDividendPayer(), ddmAssumptions)
    expect(result.dpsProjections).toHaveLength(5)
    expect(result.dpsProjections[0].dps).toBeGreaterThan(0)
  })

  it('returns null prices for non-dividend payer', () => {
    const result = computeDDM(makeNonDividendPayer(), ddmAssumptions)
    expect(result.isApplicable).toBe(false)
    expect(result.singleStagePrice).toBeNull()
    expect(result.twoStagePrice).toBeNull()
  })

  it('returns null when DDM is not applicable per assumptions', () => {
    const notApplicable: DDMAssumptions = {
      ...ddmAssumptions,
      is_applicable: false,
      applicability_reason: 'No dividends',
    }
    const result = computeDDM(makeDividendPayer(), notApplicable)
    expect(result.isApplicable).toBe(false)
    expect(result.impliedPrice).toBeNull()
  })
})
