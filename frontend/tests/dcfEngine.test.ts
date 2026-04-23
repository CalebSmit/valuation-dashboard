import { describe, it, expect } from 'vitest'
import { computeDCF } from '../src/services/dcfEngine.ts'
import type { FinancialData } from '../src/types/FinancialData.ts'
import type { Assumptions } from '../src/types/Assumptions.ts'

function makeMockData(overrides: Partial<FinancialData> = {}): FinancialData {
  return {
    ticker: 'TEST',
    companyName: 'Test Corp',
    sector: 'Technology',
    industry: 'Software',
    businessSummary: '',
    currentPrice: 100,
    sharesOutstanding: 1_000_000_000,
    marketCap: 100_000_000_000,
    enterpriseValue: 110_000_000_000,
    peRatioTTM: 20,
    forwardPE: 18,
    pbRatio: 5,
    evToEbitda: 15,
    evToRevenue: 5,
    profitMargin: 0.20,
    operatingMargin: 0.30,
    roe: 0.25,
    roa: 0.12,
    debtToEquity: 0.5,
    currentRatio: 1.5,
    beta: 1.0,
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 80,
    revenueHistory: [
      { year: '2022', value: 18_000_000_000 },
      { year: '2023', value: 20_000_000_000 },
      { year: '2024', value: 22_000_000_000 },
    ],
    ebitdaHistory: [
      { year: '2022', value: 5_000_000_000 },
      { year: '2023', value: 6_000_000_000 },
      { year: '2024', value: 7_000_000_000 },
    ],
    revenueLatest: 22_000_000_000,
    operatingIncome: 6_000_000_000,
    totalDebt: 15_000_000_000,
    totalCash: 5_000_000_000,
    totalEquity: 30_000_000_000,
    operatingCashFlow: 8_000_000_000,
    capex: 2_000_000_000,
    freeCashFlow: 6_000_000_000,
    dividendYield: 0.02,
    annualDividendRate: 2.0,
    payoutRatio: 0.4,
    dividendGrowth5yr: 0.05,
    dividendGrowth3yr: 0.06,
    yearsOfDividendHistory: 10,
    paymentFrequency: 'Quarterly',
    regressionBeta: 1.0,
    betaRSquared: 0.5,
    betaStdError: 0.1,
    riskFreeRate10yr: 0.0406,
    riskFreeRate5yr: 0.04,
    fedFundsRate: 0.05,
    cpi: 300,
    vix: 18,
    realGDPGrowth: 2.5,
    competitors: [],
    analystTargetMean: 110,
    analystTargetLow: 90,
    analystTargetHigh: 130,
    ...overrides,
  }
}

function makeMockAssumptions(): Assumptions {
  const sa = (value: number, source: string) => ({
    value, source, confidence: 'medium' as const, rationale: '',
  })

  return {
    dcf: {
      revenue_growth_rates: [
        sa(0.08, 'test'), sa(0.07, 'test'), sa(0.06, 'test'),
        sa(0.05, 'test'), sa(0.04, 'test'),
      ],
      ebitda_margin: sa(0.30, 'test'),
      capex_pct_revenue: sa(0.05, 'test'),
      nwc_pct_revenue: sa(0.02, 'test'),
      tax_rate: sa(0.21, 'test'),
      terminal_growth_rate: sa(0.025, 'test'),
      exit_multiple: sa(12, 'test'),
    },
    wacc: {
      risk_free_rate: sa(0.0406, 'FRED 10Y Treasury'),
      equity_risk_premium: sa(0.0423, 'Damodaran 2025'),
      beta: sa(1.0, 'Regression'),
      size_premium: sa(0, 'Large cap'),
      cost_of_debt: sa(0.05, 'test'),
      debt_weight: sa(0.3, 'test'),
      equity_weight: sa(0.7, 'test'),
      tax_rate: sa(0.21, 'test'),
    },
    ddm: {
      is_applicable: true,
      applicability_reason: 'test',
      short_term_growth_rate: sa(0.05, 'test'),
      long_term_growth_rate: sa(0.025, 'test'),
      required_return: sa(0.10, 'test'),
      high_growth_years: 5,
    },
    comps: {
      selected_peers: ['PEER1', 'PEER2'],
      peer_selection_rationale: 'test',
      primary_multiple: 'EV/EBITDA',
      multiple_rationale: '',
    },
    scenarios: {
      revenue_growth: {
        bear: sa(0.03, 'test'), base: sa(0.06, 'test'), bull: sa(0.10, 'test'),
      },
      ebitda_margin: {
        bear: sa(0.25, 'test'), base: sa(0.30, 'test'), bull: sa(0.35, 'test'),
      },
      exit_multiple: {
        bear: sa(10, 'test'), base: sa(12, 'test'), bull: sa(15, 'test'),
      },
      wacc: {
        bear: sa(0.10, 'test'), base: sa(0.085, 'test'), bull: sa(0.07, 'test'),
      },
    },
    investment_thesis: 'Test thesis',
    key_risks: ['Risk 1'],
  }
}

describe('computeDCF', () => {
  it('produces an implied price in a reasonable range', () => {
    const data = makeMockData()
    const assumptions = makeMockAssumptions()
    const result = computeDCF(data, assumptions)

    expect(result.impliedPrice).not.toBeNull()
    expect(result.impliedPrice!).toBeGreaterThan(10)
    expect(result.impliedPrice!).toBeLessThan(500)
  })

  it('computes WACC correctly', () => {
    const result = computeDCF(makeMockData(), makeMockAssumptions())
    expect(result.wacc).toBeGreaterThan(0.04)
    expect(result.wacc).toBeLessThan(0.15)
  })

  it('produces 5 projection years', () => {
    const result = computeDCF(makeMockData(), makeMockAssumptions())
    expect(result.projections).toHaveLength(5)
  })

  it('projects revenue growing year over year', () => {
    const result = computeDCF(makeMockData(), makeMockAssumptions())
    for (let i = 1; i < result.projections.length; i++) {
      expect(result.projections[i].revenue).toBeGreaterThan(result.projections[i - 1].revenue)
    }
  })

  it('handles zero revenue gracefully', () => {
    const data = makeMockData({ revenueLatest: 0 })
    const result = computeDCF(data, makeMockAssumptions())
    expect(result.impliedPrice).not.toBeNull()
    // With zero revenue, FCFs are zero, so price comes only from terminal value offset by net debt
  })

  it('handles zero shares outstanding without crashing', () => {
    const data = makeMockData({ sharesOutstanding: 0 })
    const result = computeDCF(data, makeMockAssumptions())
    // Should not throw — implied price will be null or 0
    expect(result).toBeDefined()
  })

  it('builds a sensitivity matrix', () => {
    const result = computeDCF(makeMockData(), makeMockAssumptions())
    expect(result.sensitivityMatrix).toHaveLength(5)
    expect(result.sensitivityMatrix[0]).toHaveLength(5)
  })

  it('Gordon Growth terminal value is null when growth >= WACC', () => {
    const assumptions = makeMockAssumptions()
    assumptions.dcf.terminal_growth_rate.value = 0.20 // > WACC
    const result = computeDCF(makeMockData(), assumptions)
    expect(result.terminalValueGordon).toBeNull()
    // Exit multiple should still work
    expect(result.impliedPriceExitMultiple).not.toBeNull()
  })
})
