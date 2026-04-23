import type { CompsOutput } from '../types/CompsOutput.ts'
import { formatCurrency, formatMultiple } from '../utils/formatters.ts'

interface CompsTabProps {
  compsOutput: CompsOutput | null
}

export function CompsTab({ compsOutput }: CompsTabProps) {
  if (!compsOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No comparable company data available</div>
  }

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
      </div>
    </div>
  )
}
