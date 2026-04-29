/**
 * Comparable Company Analysis (Comps) engine.
 * Derives implied share price from peer multiples.
 */
import type { FinancialData, CompetitorData } from '../types/FinancialData.ts'
import type { CompsAssumptions } from '../types/Assumptions.ts'
import type { CompsOutput, PeerMultiple, ImpliedPrice } from '../types/CompsOutput.ts'
import { median } from '../utils/financialMath.ts'
import { DEFAULT_COMPS_WEIGHTS } from '../utils/constants.ts'

function getLatestHistoryValue(history: FinancialData['ebitdaHistory']): number | null {
  for (const point of history) {
    if (Number.isFinite(point.value)) {
      return point.value
    }
  }
  return null
}

function computeMultiple(
  ev: number | null,
  metric: number | null,
): number | null {
  if (ev === null || metric === null || metric === 0) return null
  const result = ev / metric
  if (!isFinite(result) || result < 0) return null
  return result
}

function peerToPeerMultiple(peer: CompetitorData): PeerMultiple {
  const ev = peer.enterpriseValue
  return {
    ticker: peer.ticker,
    companyName: peer.companyName,
    evToEbitda: computeMultiple(ev, peer.ebitdaTTM),
    pe: peer.pe,
    evToSales: computeMultiple(ev, peer.salesTTM),
    pb: peer.stockholdersEquity !== null && peer.stockholdersEquity > 0 && peer.marketCap !== null
      ? peer.marketCap / peer.stockholdersEquity
      : null,
  }
}

export function computeComps(
  data: FinancialData,
  peers: CompetitorData[],
  assumptions: CompsAssumptions,
): CompsOutput {
  // Build peer multiples table
  const peerTable: PeerMultiple[] = peers
    .filter(p => p.ticker !== data.ticker)
    .map(p => peerToPeerMultiple(p))

  // Compute medians
  const medians = {
    evToEbitda: median(peerTable.map(p => p.evToEbitda).filter((v): v is number => v !== null)),
    pe: median(peerTable.map(p => p.pe).filter((v): v is number => v !== null)),
    evToSales: median(peerTable.map(p => p.evToSales).filter((v): v is number => v !== null)),
    pb: median(peerTable.map(p => p.pb).filter((v): v is number => v !== null)),
  }

  // Hard gate: a `?? 1` fallback used to silently produce $50B-per-share
  // implied prices when yfinance returned null (ADRs, post-split edge
  // cases). null/<=0 must propagate as null implied prices.
  const rawShares = data.sharesOutstanding
  const sharesOutstanding = rawShares !== null && rawShares !== undefined && rawShares > 0
    ? rawShares
    : null
  const netDebt = (data.totalDebt ?? 0) - (data.totalCash ?? 0)
  const subjectEbitda = getLatestHistoryValue(data.ebitdaHistory)
  const subjectRevenue = data.revenueLatest
  const subjectEquity = data.totalEquity

  // Derive implied prices per multiple
  const impliedPrices: ImpliedPrice[] = []

  // EV/EBITDA
  if (medians.evToEbitda !== null && subjectEbitda !== null && subjectEbitda > 0) {
    const impliedEV = medians.evToEbitda * subjectEbitda
    const equityValue = impliedEV - netDebt
    impliedPrices.push({
      multiple: 'EV/EBITDA',
      peerMedian: medians.evToEbitda,
      subjectMetric: subjectEbitda,
      impliedPrice: sharesOutstanding !== null ? equityValue / sharesOutstanding : null,
      isApplicable: true,
      reason: '',
    })
  } else {
    impliedPrices.push({
      multiple: 'EV/EBITDA',
      peerMedian: medians.evToEbitda,
      subjectMetric: subjectEbitda,
      impliedPrice: null,
      isApplicable: false,
      reason: subjectEbitda !== null && subjectEbitda <= 0
        ? 'Subject EBITDA is negative'
        : 'Insufficient peer data',
    })
  }

  // P/E
  if (medians.pe !== null && data.peRatioTTM !== null && data.peRatioTTM > 1 && data.currentPrice !== null) {
    const subjectEPS = data.currentPrice / data.peRatioTTM
    const impliedPrice = medians.pe * subjectEPS
    impliedPrices.push({
      multiple: 'P/E',
      peerMedian: medians.pe,
      subjectMetric: subjectEPS,
      impliedPrice,
      isApplicable: true,
      reason: '',
    })
  } else {
    impliedPrices.push({
      multiple: 'P/E',
      peerMedian: medians.pe,
      subjectMetric: null,
      impliedPrice: null,
      isApplicable: false,
      reason: (data.peRatioTTM ?? 0) <= 0 ? 'Subject has negative earnings' : 'Insufficient peer data',
    })
  }

  // EV/Sales
  if (medians.evToSales !== null && subjectRevenue !== null && subjectRevenue > 0) {
    const impliedEV = medians.evToSales * subjectRevenue
    const equityValue = impliedEV - netDebt
    impliedPrices.push({
      multiple: 'EV/Sales',
      peerMedian: medians.evToSales,
      subjectMetric: subjectRevenue,
      impliedPrice: sharesOutstanding !== null ? equityValue / sharesOutstanding : null,
      isApplicable: true,
      reason: '',
    })
  } else {
    impliedPrices.push({
      multiple: 'EV/Sales',
      peerMedian: medians.evToSales,
      subjectMetric: subjectRevenue,
      impliedPrice: null,
      isApplicable: false,
      reason: 'Insufficient data',
    })
  }

  // P/B
  if (medians.pb !== null && subjectEquity !== null && subjectEquity > 0) {
    const impliedMarketCap = medians.pb * subjectEquity
    impliedPrices.push({
      multiple: 'P/B',
      peerMedian: medians.pb,
      subjectMetric: subjectEquity,
      impliedPrice: sharesOutstanding !== null ? impliedMarketCap / sharesOutstanding : null,
      isApplicable: true,
      reason: '',
    })
  } else {
    impliedPrices.push({
      multiple: 'P/B',
      peerMedian: medians.pb,
      subjectMetric: subjectEquity,
      impliedPrice: null,
      isApplicable: false,
      reason: (subjectEquity ?? 0) <= 0 ? 'Negative book value' : 'Insufficient peer data',
    })
  }

  // Weighted implied price: EV/EBITDA 40%, P/E 30%, EV/Sales 20%, P/B 10%
  const multipleWeights: Record<string, number> = {
    'EV/EBITDA': assumptions.multiple_weights?.ev_ebitda ?? DEFAULT_COMPS_WEIGHTS.ev_ebitda,
    'P/E': assumptions.multiple_weights?.pe ?? DEFAULT_COMPS_WEIGHTS.pe,
    'EV/Sales': assumptions.multiple_weights?.ev_sales ?? DEFAULT_COMPS_WEIGHTS.ev_sales,
    'P/B': assumptions.multiple_weights?.pb ?? DEFAULT_COMPS_WEIGHTS.pb,
  }

  const applicableWithWeights = impliedPrices
    .filter(ip => ip.isApplicable && ip.impliedPrice !== null)
    .map(ip => ({ price: ip.impliedPrice as number, weight: multipleWeights[ip.multiple] ?? 0.25 }))

  let weightedImpliedPrice: number | null = null
  if (applicableWithWeights.length > 0) {
    const totalWeight = applicableWithWeights.reduce((sum, p) => sum + p.weight, 0)
    weightedImpliedPrice = applicableWithWeights.reduce((sum, p) => sum + p.price * p.weight, 0) / totalWeight
  }

  return {
    peerTable,
    medians,
    impliedPrices,
    weightedImpliedPrice,
    ...(sharesOutstanding === null
      ? { warning: 'Shares outstanding unavailable for this ticker — implied prices cannot be calculated.' }
      : {}),
  }
}
