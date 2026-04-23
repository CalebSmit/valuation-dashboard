import type { FinancialData } from '../types/FinancialData.ts'
import { formatMillions, formatPercent, formatMultiple } from '../utils/formatters.ts'

interface CompetitiveTabProps {
  financialData: FinancialData | null
}

export function CompetitiveTab({ financialData }: CompetitiveTabProps) {
  if (!financialData || !financialData.competitors || financialData.competitors.length === 0) {
    return <div className="p-4 font-mono text-sm clr-muted">No competitive data available</div>
  }

  const subject = financialData
  const peers = financialData.competitors.filter(c => c.ticker !== financialData.ticker)

  const rows: { label: string; subjectValue: string; peerValues: (string | null)[] }[] = [
    {
      label: 'Market Cap',
      subjectValue: formatMillions(subject.marketCap),
      peerValues: peers.map(p => formatMillions(p.marketCap)),
    },
    {
      label: 'P/E (TTM)',
      subjectValue: formatMultiple(subject.peRatioTTM),
      peerValues: peers.map(p => formatMultiple(p.pe)),
    },
    {
      label: 'EV/EBITDA',
      subjectValue: formatMultiple(subject.evToEbitda),
      peerValues: peers.map(p => {
        if (p.enterpriseValue === null || p.ebitdaTTM === null || p.ebitdaTTM === 0) return 'N/A'
        return formatMultiple(p.enterpriseValue / p.ebitdaTTM)
      }),
    },
    {
      label: 'Profit Margin',
      subjectValue: formatPercent(subject.profitMargin),
      peerValues: peers.map(p => formatPercent(p.profitMargin)),
    },
    {
      label: 'Operating Margin',
      subjectValue: formatPercent(subject.operatingMargin),
      peerValues: peers.map(p => formatPercent(p.operatingMargin)),
    },
    {
      label: 'ROE',
      subjectValue: formatPercent(subject.roe),
      peerValues: peers.map(p => formatPercent(p.roe)),
    },
    {
      label: 'Debt/Equity',
      subjectValue: subject.debtToEquity !== null ? subject.debtToEquity.toFixed(2) : 'N/A',
      peerValues: peers.map(p => p.debtToEquity !== null ? p.debtToEquity.toFixed(2) : 'N/A'),
    },
    {
      label: 'Beta',
      subjectValue: subject.beta?.toFixed(2) ?? 'N/A',
      peerValues: peers.map(p => p.beta !== null ? p.beta.toFixed(2) : 'N/A'),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="p-4 card">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Competitive Benchmarking
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
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
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label} className="row-b">
                  <td className="py-1.5 clr-muted">{row.label}</td>
                  <td className="text-right py-1.5 font-semibold clr-accent">
                    {row.subjectValue}
                  </td>
                  {row.peerValues.map((val, i) => (
                    <td key={i} className="text-right py-1.5 clr-text">
                      {val ?? 'N/A'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
