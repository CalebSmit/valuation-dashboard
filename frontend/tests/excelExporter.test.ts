import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import type { ValuationRun } from '../src/types/ValuationRun.ts'

// We test the sheet-building logic by importing the exporter and intercepting XLSX.writeFile
vi.mock('xlsx', async () => {
  const actual = await vi.importActual<typeof import('xlsx')>('xlsx')
  return {
    ...actual,
    writeFile: vi.fn(),
  }
})

// Dynamically import after mock is set up
const { exportToExcel } = await import('../src/services/excelExporter.ts')

function makeMockRun(): ValuationRun {
  const sa = (value: number, source: string) => ({
    value, source, confidence: 'medium' as const, rationale: '',
  })

  return {
    id: 'test-id',
    ticker: 'TEST',
    companyName: 'Test Corp',
    currentPrice: 100,
    createdAt: Date.now(),
    status: 'complete',
    financialData: {
      ticker: 'TEST', companyName: 'Test Corp', sector: 'Tech', industry: 'Software',
      businessSummary: '', currentPrice: 100, sharesOutstanding: 1e9,
      marketCap: 1e11, enterpriseValue: 1.1e11, peRatioTTM: 20, forwardPE: 18,
      pbRatio: 5, evToEbitda: 15, evToRevenue: 5, profitMargin: 0.2,
      operatingMargin: 0.3, roe: 0.25, roa: 0.12, debtToEquity: 0.5,
      currentRatio: 1.5, beta: 1.0, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 80,
      revenueHistory: [{ year: '2024', value: 2.2e10 }],
      ebitdaHistory: [{ year: '2024', value: 7e9 }],
      revenueLatest: 2.2e10, operatingIncome: 6e9,
      totalDebt: 1.5e10, totalCash: 5e9, totalEquity: 3e10,
      operatingCashFlow: 8e9, capex: 2e9, freeCashFlow: 6e9,
      dividendYield: 0.02, annualDividendRate: 2.0, payoutRatio: 0.4,
      dividendGrowth5yr: 0.05, dividendGrowth3yr: 0.06,
      yearsOfDividendHistory: 10, paymentFrequency: 'Quarterly',
      regressionBeta: 1.0, betaRSquared: 0.5, betaStdError: 0.1,
      riskFreeRate10yr: 0.04, riskFreeRate5yr: 0.038, fedFundsRate: 0.05,
      cpi: 300, vix: 18, realGDPGrowth: 2.5,
      competitors: [], analystTargetMean: 110, analystTargetLow: 90, analystTargetHigh: 130,
    },
    assumptions: {
      dcf: {
        revenue_growth_rates: [sa(0.08, 'test'), sa(0.07, 'test'), sa(0.06, 'test'), sa(0.05, 'test'), sa(0.04, 'test')],
        ebitda_margin: sa(0.3, 'test'), capex_pct_revenue: sa(0.05, 'test'),
        nwc_pct_revenue: sa(0.02, 'test'), tax_rate: sa(0.21, 'test'),
        terminal_growth_rate: sa(0.025, 'test'), exit_multiple: sa(12, 'test'),
      },
      wacc: {
        risk_free_rate: sa(0.04, 'FRED'), equity_risk_premium: sa(0.042, 'Damodaran'),
        beta: sa(1.0, 'Regression'), size_premium: sa(0, 'Large cap'),
        cost_of_debt: sa(0.05, 'test'), debt_weight: sa(0.3, 'test'),
        equity_weight: sa(0.7, 'test'), tax_rate: sa(0.21, 'test'),
      },
      ddm: { is_applicable: true, applicability_reason: 'test', short_term_growth_rate: sa(0.05, 'test'), long_term_growth_rate: sa(0.025, 'test'), required_return: sa(0.10, 'test'), high_growth_years: 5 },
      comps: { selected_peers: ['PEER1'], peer_selection_rationale: 'test', primary_multiple: 'EV/EBITDA', multiple_rationale: '' },
      scenarios: {
        revenue_growth: { bear: sa(0.03, 'test'), base: sa(0.06, 'test'), bull: sa(0.10, 'test') },
        ebitda_margin: { bear: sa(0.25, 'test'), base: sa(0.30, 'test'), bull: sa(0.35, 'test') },
        exit_multiple: { bear: sa(10, 'test'), base: sa(12, 'test'), bull: sa(15, 'test') },
        wacc: { bear: sa(0.10, 'test'), base: sa(0.085, 'test'), bull: sa(0.07, 'test') },
      },
      investment_thesis: 'Test thesis',
      key_risks: ['Risk 1'],
    },
    overrideAssumptions: {},
    dcfOutput: {
      wacc: 0.085, costOfEquity: 0.082, afterTaxCostOfDebt: 0.0395,
      projections: [
        { year: 1, revenue: 2.376e10, revenueGrowth: 0.08, ebitda: 7.128e9, ebitdaMargin: 0.3, capex: 1.188e9, nwcChange: 4.752e8, taxes: 1.497e9, freeCashFlow: 3.968e9, discountFactor: 0.922, pvFCF: 3.658e9 },
        { year: 2, revenue: 2.542e10, revenueGrowth: 0.07, ebitda: 7.627e9, ebitdaMargin: 0.3, capex: 1.271e9, nwcChange: 5.085e8, taxes: 1.602e9, freeCashFlow: 4.246e9, discountFactor: 0.850, pvFCF: 3.609e9 },
        { year: 3, revenue: 2.695e10, revenueGrowth: 0.06, ebitda: 8.085e9, ebitdaMargin: 0.3, capex: 1.347e9, nwcChange: 5.39e8, taxes: 1.698e9, freeCashFlow: 4.501e9, discountFactor: 0.783, pvFCF: 3.524e9 },
        { year: 4, revenue: 2.829e10, revenueGrowth: 0.05, ebitda: 8.489e9, ebitdaMargin: 0.3, capex: 1.415e9, nwcChange: 5.659e8, taxes: 1.783e9, freeCashFlow: 4.726e9, discountFactor: 0.722, pvFCF: 3.413e9 },
        { year: 5, revenue: 2.943e10, revenueGrowth: 0.04, ebitda: 8.829e9, ebitdaMargin: 0.3, capex: 1.471e9, nwcChange: 5.886e8, taxes: 1.854e9, freeCashFlow: 4.915e9, discountFactor: 0.666, pvFCF: 3.273e9 },
      ],
      terminalValueGordon: 83955e6, terminalValueExitMultiple: 105948e6,
      pvTerminalGordon: 55900e6, pvTerminalExitMultiple: 70575e6,
      pvFCFTotal: 17477e6, enterpriseValueGordon: 73377e6, enterpriseValueExitMultiple: 88052e6,
      netDebt: 1e10, equityValueGordon: 63377e6, equityValueExitMultiple: 78052e6,
      impliedPriceGordon: 63.38, impliedPriceExitMultiple: 78.05,
      impliedPrice: 70.71, sharesOutstanding: 1e9,
      sensitivityMatrix: [[60, 65, 70, 75, 80], [55, 60, 65, 70, 75], [50, 55, 60, 65, 70], [45, 50, 55, 60, 65], [40, 45, 50, 55, 60]],
      sensitivityWACCRange: [0.065, 0.075, 0.085, 0.095, 0.105],
      sensitivityTerminalRange: [10, 11, 12, 13, 14],
    },
    ddmOutput: {
      isApplicable: true,
      applicabilityCriteria: [
        { name: 'Pays dividends', pass: true, detail: 'Yield: 2%' },
        { name: 'History', pass: true, detail: '10 years' },
        { name: 'Payout', pass: true, detail: '40%' },
        { name: 'Earnings', pass: true, detail: 'PE: 20' },
      ],
      applicabilityScore: 4, singleStagePrice: 27.33, twoStagePrice: 32.15,
      impliedPrice: 32.15, currentDPS: 2.0, requiredReturn: 0.10,
      shortTermGrowth: 0.05, longTermGrowth: 0.025,
      dpsProjections: [
        { year: 1, dps: 2.10, growthRate: 0.05, pvDPS: 1.91 },
        { year: 2, dps: 2.205, growthRate: 0.05, pvDPS: 1.82 },
      ],
    },
    compsOutput: {
      peerTable: [{ ticker: 'PEER1', companyName: 'Peer One', evToEbitda: 12, pe: 18, evToSales: 4, pb: 3 }],
      medians: { evToEbitda: 12, pe: 18, evToSales: 4, pb: 3 },
      impliedPrices: [
        { multiple: 'EV/EBITDA', peerMedian: 12, subjectMetric: 7e9, impliedPrice: 74, isApplicable: true, reason: '' },
        { multiple: 'P/E', peerMedian: 18, subjectMetric: 5, impliedPrice: 90, isApplicable: true, reason: '' },
      ],
      weightedImpliedPrice: 82,
    },
    scenarioOutput: {
      bear: { name: 'bear', drivers: [], dcfPrice: 55, ddmPrice: 25, compsPrice: 60, weightedPrice: 47 },
      base: { name: 'base', drivers: [], dcfPrice: 71, ddmPrice: 32, compsPrice: 82, weightedPrice: 62 },
      bull: { name: 'bull', drivers: [], dcfPrice: 95, ddmPrice: 40, compsPrice: 110, weightedPrice: 82 },
      probabilityWeights: { bear: 0.25, base: 0.5, bull: 0.25 },
      drivers: [
        { assumption: 'Revenue Growth', bearValue: 0.03, baseValue: 0.06, bullValue: 0.10, bearSource: 't', baseSource: 't', bullSource: 't' },
      ],
    },
    agentLog: [],
    error: null,
  }
}

describe('excelExporter', () => {
  it('generates a workbook with all required sheet names', () => {
    const mockRun = makeMockRun()
    exportToExcel(mockRun)

    expect(XLSX.writeFile).toHaveBeenCalledOnce()
    const call = vi.mocked(XLSX.writeFile).mock.calls[0]
    const wb = call[0] as XLSX.WorkBook

    const sheetNames = wb.SheetNames
    expect(sheetNames).toContain('Financial Statement Forecast')
    expect(sheetNames).toContain('DCF')
    expect(sheetNames).toContain('DDM')
    expect(sheetNames).toContain('Relative Valuation')
    expect(sheetNames).toContain('Scenario Analysis')
    expect(sheetNames).toContain('About_Company')
    expect(sheetNames).toContain('Sources_Methodology')
    expect(sheetNames).toHaveLength(7)
  })

  it('filename includes ticker and date', () => {
    const mockRun = makeMockRun()
    exportToExcel(mockRun)

    const call = vi.mocked(XLSX.writeFile).mock.calls[0]
    const filename = call[1] as string
    expect(filename).toContain('TEST_Valuation_')
    expect(filename).toMatch(/\.xlsx$/)
  })

  it('DCF sheet has WACC row', () => {
    const mockRun = makeMockRun()
    exportToExcel(mockRun)

    const call = vi.mocked(XLSX.writeFile).mock.calls[0]
    const wb = call[0] as XLSX.WorkBook
    const dcfSheet = wb.Sheets['DCF']
    const data = XLSX.utils.sheet_to_json<string[]>(dcfSheet, { header: 1 })

    const waccRow = data.find(row => row[0] === 'WACC')
    expect(waccRow).toBeDefined()
  })

  it('DCF sheet has assumption markers [A]', () => {
    const mockRun = makeMockRun()
    exportToExcel(mockRun)

    const call = vi.mocked(XLSX.writeFile).mock.calls[0]
    const wb = call[0] as XLSX.WorkBook
    const dcfSheet = wb.Sheets['DCF']
    const data = XLSX.utils.sheet_to_json<string[]>(dcfSheet, { header: 1 })

    const assumptionRows = data.filter(row => typeof row[0] === 'string' && row[0].includes('[A]'))
    expect(assumptionRows.length).toBeGreaterThanOrEqual(5)
  })
})
