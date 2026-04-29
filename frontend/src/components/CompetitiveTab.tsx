import type { FinancialData } from '../types/FinancialData.ts'
import { formatMillions, formatPercent, formatMultiple } from '../utils/formatters.ts'

interface CompetitiveTabProps {
  financialData: FinancialData | null
  selectedPeers?: string[]
  failedPeers?: number
}

/** Metrics where HIGHER = better (outperforms if subject > peer median) */
const HIGHER_IS_BETTER = new Set(['Profit Margin', 'Operating Margin', 'ROE'])
/** Metrics where LOWER = better */
const LOWER_IS_BETTER = new Set(['Debt/Equity', 'Beta'])
/** Neutral metrics (no color coding) */
// Market Cap, P/E, EV/EBITDA are neutral

function peerMedian(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (valid.length === 0) return null
  const mid = Math.floor(valid.length / 2)
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid]
}

interface MetricBarProps {
  label: string
  subjectVal: number
  medianVal: number
  maxVal: number
}

function MetricBar({ label, subjectVal, medianVal, maxVal }: MetricBarProps) {
  const subjectPct = maxVal > 0 ? Math.min(100, (subjectVal / maxVal) * 100) : 0
  const medianPct = maxVal > 0 ? Math.min(100, (medianVal / maxVal) * 100) : 0

  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono clr-muted">{label}</span>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="clr-accent">Subject: {formatPercent(subjectVal)}</span>
          <span className="clr-amber">Median: {formatPercent(medianVal)}</span>
        </div>
      </div>
      {/* Subject bar */}
      <div className="relative h-3 bg-[#161B22] rounded overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded transition-all"
          style={{ width: `${subjectPct}%`, background: '#00FF88', opacity: 0.8 }}
        />
      </div>
      {/* Peer median bar */}
      <div className="relative h-2 bg-[#161B22] rounded overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded transition-all"
          style={{ width: `${medianPct}%`, background: '#F0A500', opacity: 0.7 }}
        />
      </div>
      <div className="flex gap-4 text-[10px] font-mono clr-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#00FF88] opacity-80" />Subject</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#F0A500] opacity-70" />Peer Median</span>
      </div>
    </div>
  )
}

export function CompetitiveTab({ financialData, selectedPeers = [], failedPeers = 0 }: CompetitiveTabProps) {
  if (!financialData || !financialData.competitors || financialData.competitors.length === 0) {
    // Distinguish "AI never selected peers" from "Yahoo dropped all of them"
    // so the user knows whether to retry the run vs. accept that comps
    // are not applicable for this ticker.
    if (selectedPeers.length === 0) {
      return (
        <div className="p-4 font-mono text-sm clr-muted">
          No peers selected for this ticker — comps analysis is not applicable.
        </div>
      )
    }
    return (
      <div className="p-4 card">
        <div className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
          Competitive Comparison
        </div>
        <div className="text-sm font-mono text-[#F0A500]">
          Peer data unavailable
        </div>
        <p className="text-xs font-mono clr-muted mt-2 leading-relaxed">
          The AI selected {selectedPeers.length} peer{selectedPeers.length === 1 ? '' : 's'}
          {' '}({selectedPeers.join(', ')}), but Yahoo Finance returned no usable data for any of them.
          This is usually a transient rate-limit. Wait 30–60 seconds and click Analyze again.
        </p>
      </div>
    )
  }

  const subject = financialData
  const peers = financialData.competitors.filter(c => c.ticker !== financialData.ticker)

  interface RowDef {
    label: string
    subjectValue: string
    subjectRaw: number | null
    peerValues: (string | null)[]
    peerRaws: (number | null)[]
  }

  const rows: RowDef[] = [
    {
      label: 'Market Cap',
      subjectValue: formatMillions(subject.marketCap),
      subjectRaw: subject.marketCap ?? null,
      peerValues: peers.map(p => formatMillions(p.marketCap)),
      peerRaws: peers.map(p => p.marketCap ?? null),
    },
    {
      label: 'P/E (TTM)',
      subjectValue: formatMultiple(subject.peRatioTTM),
      subjectRaw: subject.peRatioTTM ?? null,
      peerValues: peers.map(p => formatMultiple(p.pe)),
      peerRaws: peers.map(p => p.pe ?? null),
    },
    {
      label: 'EV/EBITDA',
      subjectValue: formatMultiple(subject.evToEbitda),
      subjectRaw: subject.evToEbitda ?? null,
      peerValues: peers.map(p => {
        if (p.enterpriseValue === null || p.ebitdaTTM === null || p.ebitdaTTM === 0) return null
        return formatMultiple(p.enterpriseValue / p.ebitdaTTM)
      }),
      peerRaws: peers.map(p => {
        if (p.enterpriseValue === null || p.ebitdaTTM === null || p.ebitdaTTM === 0) return null
        return p.enterpriseValue / p.ebitdaTTM
      }),
    },
    {
      label: 'Profit Margin',
      subjectValue: formatPercent(subject.profitMargin),
      subjectRaw: subject.profitMargin ?? null,
      peerValues: peers.map(p => formatPercent(p.profitMargin)),
      peerRaws: peers.map(p => p.profitMargin ?? null),
    },
    {
      label: 'Operating Margin',
      subjectValue: formatPercent(subject.operatingMargin),
      subjectRaw: subject.operatingMargin ?? null,
      peerValues: peers.map(p => formatPercent(p.operatingMargin)),
      peerRaws: peers.map(p => p.operatingMargin ?? null),
    },
    {
      label: 'ROE',
      subjectValue: formatPercent(subject.roe),
      subjectRaw: subject.roe ?? null,
      peerValues: peers.map(p => formatPercent(p.roe)),
      peerRaws: peers.map(p => p.roe ?? null),
    },
    {
      label: 'Debt/Equity',
      subjectValue: subject.debtToEquity !== null ? subject.debtToEquity.toFixed(2) : 'N/A',
      subjectRaw: subject.debtToEquity ?? null,
      peerValues: peers.map(p => p.debtToEquity !== null ? p.debtToEquity.toFixed(2) : null),
      peerRaws: peers.map(p => p.debtToEquity ?? null),
    },
    {
      label: 'Beta',
      subjectValue: subject.beta?.toFixed(2) ?? 'N/A',
      subjectRaw: subject.beta ?? null,
      peerValues: peers.map(p => p.beta !== null ? p.beta.toFixed(2) : null),
      peerRaws: peers.map(p => p.beta ?? null),
    },
  ]

  // Count outperformance
  let outperformCount = 0
  let comparableCount = 0
  for (const row of rows) {
    const median = peerMedian(row.peerRaws)
    if (median === null || row.subjectRaw === null) continue
    if (HIGHER_IS_BETTER.has(row.label)) {
      comparableCount++
      if (row.subjectRaw > median) outperformCount++
    } else if (LOWER_IS_BETTER.has(row.label)) {
      comparableCount++
      if (row.subjectRaw < median) outperformCount++
    }
  }

  // Bar chart metrics (top 3)
  const barMetrics = ['Profit Margin', 'Operating Margin', 'ROE'] as const
  const barRows = rows.filter(r => barMetrics.includes(r.label as typeof barMetrics[number]))

  function getCellClass(row: RowDef): string {
    const median = peerMedian(row.peerRaws)
    if (median === null || row.subjectRaw === null) return 'clr-accent'
    if (HIGHER_IS_BETTER.has(row.label)) {
      return row.subjectRaw > median ? 'text-[#3FB950]' : 'text-[#F85149]'
    }
    if (LOWER_IS_BETTER.has(row.label)) {
      return row.subjectRaw < median ? 'text-[#3FB950]' : 'text-[#F85149]'
    }
    return 'clr-accent'
  }

  return (
    <div className="flex flex-col gap-5">
      {failedPeers > 0 && (
        <div className="p-2 rounded text-xs font-mono border border-[#F0A500] text-[#F0A500] bg-[#F0A500]/10">
          {failedPeers} of {selectedPeers.length || (peers.length + failedPeers)} peer ticker
          {failedPeers === 1 ? '' : 's'} could not be loaded — comparisons use the {peers.length}
          {' '}peer{peers.length === 1 ? '' : 's'} that did load.
        </div>
      )}

      {/* Positioning Summary */}
      <div className="px-4 py-2 card text-xs font-mono clr-muted">
        <span className="clr-accent font-semibold">{subject.ticker || 'Subject'}</span>
        {' outperforms peers on '}
        <span className="clr-success font-semibold">{outperformCount} of {comparableCount}</span>
        {' comparable metrics'}
      </div>

      {/* Visual Bar Chart — top 3 metrics */}
      <div className="card p-4">
        <h4 className="text-xs uppercase tracking-wider mb-4 font-mono clr-muted">
          Key Metrics vs Peer Median
        </h4>
        {barRows.map(row => {
          const median = peerMedian(row.peerRaws)
          if (row.subjectRaw === null || median === null) return null
          const maxVal = Math.max(row.subjectRaw, median, 0.001)
          return (
            <MetricBar
              key={row.label}
              label={row.label}
              subjectVal={row.subjectRaw}
              medianVal={median}
              maxVal={maxVal}
            />
          )
        })}
      </div>

      {/* Full Table */}
      <div className="p-4 card">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Competitive Benchmarking
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 z-10 bg-[#161B22]">
              <tr className="row-b">
                <th className="text-left py-2 clr-muted">Metric</th>
                <th className="text-right py-2 clr-accent">
                  {subject.ticker || 'Subject'}
                </th>
                {peers.map(p => (
                  <th key={p.ticker} className="text-right py-2 clr-text">
                    {p.ticker}
                  </th>
                ))}
                <th className="text-right py-2 clr-amber">Median</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const median = peerMedian(row.peerRaws)
                return (
                  <tr key={row.label} className="row-b">
                    <td className="py-1.5 clr-muted">{row.label}</td>
                    <td className={`text-right py-1.5 font-semibold ${getCellClass(row)}`}>
                      {row.subjectValue}
                    </td>
                    {row.peerValues.map((val, i) => (
                      <td key={i} className="text-right py-1.5 clr-text">
                        {val ?? 'N/A'}
                      </td>
                    ))}
                    <td className="text-right py-1.5 clr-amber font-semibold">
                      {median !== null
                        ? (row.label === 'Profit Margin' || row.label === 'Operating Margin' || row.label === 'ROE'
                          ? formatPercent(median)
                          : row.label === 'Debt/Equity' || row.label === 'Beta'
                            ? median.toFixed(2)
                            : row.label === 'Market Cap'
                              ? formatMillions(median)
                              : formatMultiple(median))
                        : 'N/A'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
