import type { CompsOutput } from '../types/CompsOutput.ts'
import { UpsideLabel } from './UpsideLabel.tsx'
import { CalcBreakdown } from './CalcBreakdown.tsx'
import { formatCurrency, formatMultiple } from '../utils/formatters.ts'

interface CompsTabProps {
  compsOutput: CompsOutput | null
  currentPrice?: number | null
}

export function CompsTab({ compsOutput, currentPrice }: CompsTabProps) {
  if (!compsOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No comparable company data available</div>
  }

  // Build comps calculation breakdown
  const appliedPrices = compsOutput.impliedPrices.filter(ip => ip.isApplicable && ip.impliedPrice !== null)
  const compsBreakdown = compsOutput.weightedImpliedPrice !== null ? (
    <span>
      <span className="text-slate-400">Peer median multiples applied to subject company metrics:</span>
      {appliedPrices.map((ip, i) => (
        <span key={ip.multiple}>
          {i > 0 ? ' | ' : ' '}
          <span className="text-slate-400">{ip.multiple}:</span>{' '}
          {ip.peerMedian !== null && (
            <span className="text-slate-300">peer median {formatMultiple(ip.peerMedian)}</span>
          )}
          {' → '}
          <span className="text-amber-400">{formatCurrency(ip.impliedPrice)}/share</span>
        </span>
      ))}
      {' | '}
      <span className="text-slate-400">Weighted average:</span>{' '}
      <span className="text-green-300 font-semibold">{formatCurrency(compsOutput.weightedImpliedPrice)}/share</span>
    </span>
  ) : (
    <span className="text-slate-400">No applicable multiples to display.</span>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Peer Multiples Table */}
      <div className="p-4 card">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Peer Comparison
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="row-b">
                <th className="text-left py-2 clr-muted">Ticker</th>
                <th className="text-left py-2 clr-muted">Company</th>
                <th className="text-right py-2 clr-muted">EV/EBITDA</th>
                <th className="text-right py-2 clr-muted">P/E</th>
                <th className="text-right py-2 clr-muted">EV/Sales</th>
                <th className="text-right py-2 clr-muted">P/B</th>
              </tr>
            </thead>
            <tbody>
              {compsOutput.peerTable.map(peer => (
                <tr
                  key={peer.ticker}
                  className="row-b"
                >
                  <td className="py-1.5 clr-accent">{peer.ticker}</td>
                  <td className="py-1.5 cell-truncate">
                    {peer.companyName}
                  </td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.evToEbitda)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.pe)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.evToSales)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.pb)}</td>
                </tr>
              ))}
              {/* Median row */}
              <tr className="row-t-amber bg-surface-alt">
                <td className="py-2 font-semibold clr-amber">Median</td>
                <td className="py-2" />
                <td className="text-right py-2 font-semibold clr-amber">
                  {formatMultiple(compsOutput.medians.evToEbitda)}
                </td>
                <td className="text-right py-2 font-semibold clr-amber">
                  {formatMultiple(compsOutput.medians.pe)}
                </td>
                <td className="text-right py-2 font-semibold clr-amber">
                  {formatMultiple(compsOutput.medians.evToSales)}
                </td>
                <td className="text-right py-2 font-semibold clr-amber">
                  {formatMultiple(compsOutput.medians.pb)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Implied Prices */}
      <div className="p-4 card">
        {/* Prominent upside/downside label — first thing the eye sees */}
        <UpsideLabel
          impliedPrice={compsOutput.weightedImpliedPrice}
          currentPrice={currentPrice ?? null}
          modelName="Comps"
        />
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Implied Price by Multiple
        </h4>
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="row-b">
              <th className="text-left py-2 text-xs clr-muted">Multiple</th>
              <th className="text-right py-2 text-xs clr-muted">Peer Median</th>
              <th className="text-right py-2 text-xs clr-muted">Implied Price</th>
              <th className="text-right py-2 text-xs clr-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {compsOutput.impliedPrices.map(ip => (
              <tr key={ip.multiple} className="row-b">
                <td className="py-1.5 clr-text">{ip.multiple}</td>
                <td className="text-right py-1.5 clr-text">
                  {ip.peerMedian !== null ? formatMultiple(ip.peerMedian) : 'N/A'}
                </td>
                <td className={`text-right py-1.5 font-semibold ${ip.isApplicable ? 'clr-amber' : 'clr-muted'}`}>
                  {ip.isApplicable ? formatCurrency(ip.impliedPrice) : 'N/A'}
                </td>
                <td className={`text-right py-1.5 text-xs ${ip.isApplicable ? 'clr-success' : 'clr-muted'}`}>
                  {ip.isApplicable ? 'Applied' : ip.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {compsOutput.weightedImpliedPrice !== null && (
          <div className="mt-3 pt-3 flex justify-between row-t-amber">
            <span className="font-mono text-xs font-semibold clr-amber">Weighted Implied Price</span>
            <span className="font-mono text-base font-bold clr-amber">
              {formatCurrency(compsOutput.weightedImpliedPrice)}
            </span>
          </div>
        )}
        {/* How this was calculated */}
        <CalcBreakdown formula={compsBreakdown} />
      </div>
    </div>
  )
}
