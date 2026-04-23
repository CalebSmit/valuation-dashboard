import { describe, it, expect } from 'vitest'
import { computeComps } from '../src/services/compsEngine.ts'
import type { FinancialData, CompetitorData } from '../src/types/FinancialData.ts'
import type { CompsAssumptions } from '../src/types/Assumptions.ts'

function makeSubject(): FinancialData {
  return {
    ticker: 'SUBJ', companyName: 'Subject Corp', sector: 'Tech',
    industry: 'Software', businessSummary: '', currentPrice: 100,
    sharesOutstanding: 1_000_000_000, marketCap: 100_000_000_000,
    enterpriseValue: 110_000_000_000, peRatioTTM: 20, forwardPE: 18,
    pbRatio: 5, evToEbitda: 15, evToRevenue: 5, profitMargin: 0.20,
    operatingMargin: 0.30, roe: 0.25, roa: 0.12, debtToEquity: 0.5,
    currentRatio: 1.5, beta: 1.0, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80,
    revenueHistory: [], ebitdaHistory: [
      { year: '2024', value: 7_000_000_000 },
    ],
    revenueLatest: 22_000_000_000, operatingIncome: 6_000_000_000,
    totalDebt: 15_000_000_000, totalCash: 5_000_000_000,
    totalEquity: 30_000_000_000, operatingCashFlow: 8_000_000_000,
    capex: 2_000_000_000, freeCashFlow: 6_000_000_000,
    dividendYield: 0.02, annualDividendRate: 2.0, payoutRatio: 0.4,
    dividendGrowth5yr: 0.05, dividendGrowth3yr: 0.06,
    yearsOfDividendHistory: 10, paymentFrequency: 'Quarterly',
    regressionBeta: 1.0, betaRSquared: 0.5, betaStdError: 0.1,
    riskFreeRate10yr: 0.04, riskFreeRate5yr: 0.038, fedFundsRate: 0.05,
    cpi: 300, vix: 18, realGDPGrowth: 2.5,
    competitors: [], analystTargetMean: 110, analystTargetLow: 90, analystTargetHigh: 130,
  }
}

function makePeers(): CompetitorData[] {
  return [
    {
      ticker: 'PEER1', companyName: 'Peer One',
      marketCap: 80_000_000_000, pe: 18,
      enterpriseValue: 90_000_000_000, salesTTM: 18_000_000_000,
      ebitdaTTM: 6_000_000_000, stockholdersEquity: 25_000_000_000,
    },
    {
      ticker: 'PEER2', companyName: 'Peer Two',
      marketCap: 120_000_000_000, pe: 22,
      enterpriseValue: 130_000_000_000, salesTTM: 25_000_000_000,
      ebitdaTTM: 8_000_000_000, stockholdersEquity: 40_000_000_000,
    },
    {
      ticker: 'PEER3', companyName: 'Peer Three',
      marketCap: 60_000_000_000, pe: 16,
      enterpriseValue: 65_000_000_000, salesTTM: 15_000_000_000,
      ebitdaTTM: 5_000_000_000, stockholdersEquity: 20_000_000_000,
    },
    {
      ticker: 'PEER4', companyName: 'Peer Four',
      marketCap: 90_000_000_000, pe: 19,
      enterpriseValue: 100_000_000_000, salesTTM: 20_000_000_000,
      ebitdaTTM: 7_000_000_000, stockholdersEquity: 35_000_000_000,
    },
  ]
}

const compsAssumptions: CompsAssumptions = {
  selected_peers: ['PEER1', 'PEER2', 'PEER3', 'PEER4'],
  peer_selection_rationale: 'Same sector',
  primary_multiple: 'EV/EBITDA',
  multiple_rationale: '',
}

describe('computeComps', () => {
  it('computes peer medians', () => {
    const result = computeComps(makeSubject(), makePeers(), compsAssumptions)
    expect(result.medians.evToEbitda).not.toBeNull()
    expect(result.medians.pe).not.toBeNull()
  })

  it('derives implied prices for applicable multiples', () => {
    const result = computeComps(makeSubject(), makePeers(), compsAssumptions)
    const applicable = result.impliedPrices.filter(ip => ip.isApplicable)
    expect(applicable.length).toBeGreaterThanOrEqual(2)
    for (const ip of applicable) {
      expect(ip.impliedPrice).not.toBeNull()
      expect(ip.impliedPrice!).toBeGreaterThan(0)
    }
  })

  it('produces a weighted implied price', () => {
    const result = computeComps(makeSubject(), makePeers(), compsAssumptions)
    expect(result.weightedImpliedPrice).not.toBeNull()
    expect(result.weightedImpliedPrice!).toBeGreaterThan(0)
  })

  it('handles negative EBITDA peer gracefully', () => {
    const peers = makePeers()
    peers[0].ebitdaTTM = -1_000_000_000 // Negative EBITDA
    const result = computeComps(makeSubject(), peers, compsAssumptions)
    // Should still compute — negative EBITDA peer gets null EV/EBITDA
    const peer1 = result.peerTable.find(p => p.ticker === 'PEER1')
    expect(peer1?.evToEbitda).toBeNull()
    // Median should still work from remaining peers
    expect(result.medians.evToEbitda).not.toBeNull()
  })

  it('marks EV/EBITDA as inapplicable when subject has negative EBITDA', () => {
    const subject = makeSubject()
    subject.ebitdaHistory = [{ year: '2024', value: -1_000_000_000 }]
    const result = computeComps(subject, makePeers(), compsAssumptions)
    const evEbitda = result.impliedPrices.find(ip => ip.multiple === 'EV/EBITDA')
    expect(evEbitda?.isApplicable).toBe(false)
  })

  it('uses the newest EBITDA when history is newest-first', () => {
    const subject = makeSubject()
    subject.ebitdaHistory = [
      { year: '2024', value: 7_000_000_000 },
      { year: '2023', value: 6_000_000_000 },
      { year: '2022', value: 5_000_000_000 },
    ]

    const result = computeComps(subject, makePeers(), compsAssumptions)
    const evEbitda = result.impliedPrices.find(ip => ip.multiple === 'EV/EBITDA')

    expect(evEbitda?.subjectMetric).toBe(7_000_000_000)
  })

  it('marks EV/EBITDA inapplicable when history has no finite values', () => {
    const subject = makeSubject()
    subject.ebitdaHistory = [
      { year: '2024', value: Number.NaN },
      { year: '2023', value: Number.NaN },
    ]

    const result = computeComps(subject, makePeers(), compsAssumptions)
    const evEbitda = result.impliedPrices.find(ip => ip.multiple === 'EV/EBITDA')

    expect(evEbitda?.subjectMetric).toBeNull()
    expect(evEbitda?.isApplicable).toBe(false)
  })

  it('handles empty peer list', () => {
    const result = computeComps(makeSubject(), [], compsAssumptions)
    expect(result.peerTable).toHaveLength(0)
    expect(result.weightedImpliedPrice).toBeNull()
  })
})
