import type {
  InstitutionalHolder,
  InsiderTransaction,
  OwnershipConcentration,
} from '../types/FinancialData.ts'
import { formatMillions, formatPercent } from '../utils/formatters.ts'

interface OwnershipCardProps {
  holders: InstitutionalHolder[] | undefined
  insiders: InsiderTransaction[] | undefined
  concentration: OwnershipConcentration | undefined
}

function formatShares(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}K`
  return value.toFixed(0)
}

function transactionTone(transaction: string): string {
  const lc = transaction.toLowerCase()
  if (lc.includes('purchase') || lc.includes('buy') || lc.includes('acquired')) {
    return 'text-[#3FB950]'
  }
  if (lc.includes('sale') || lc.includes('sell') || lc.includes('disposed')) {
    return 'text-[#F85149]'
  }
  return 'clr-text'
}

export function OwnershipCard({ holders, insiders, concentration }: OwnershipCardProps) {
  const hasHolders = holders && holders.length > 0
  const hasInsiders = insiders && insiders.length > 0
  if (!hasHolders && !hasInsiders) return null

  const topPercent = concentration?.topHoldersPercent ?? null

  return (
    <div className="p-4 card">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
          Ownership Signals
        </h4>
        {topPercent !== null && (
          <span className="text-xs font-mono clr-muted">
            Top holders own {formatPercent(topPercent)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {hasHolders && (
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-2 font-mono clr-muted">
              Top Institutional Holders
            </div>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="row-b">
                  <th className="text-left py-1 clr-muted font-normal">Holder</th>
                  <th className="text-right py-1 clr-muted font-normal">% Out</th>
                  <th className="text-right py-1 clr-muted font-normal">Shares</th>
                  <th className="text-right py-1 clr-muted font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {holders!.slice(0, 8).map((h, i) => (
                  <tr key={`${h.holder}-${i}`} className="row-b">
                    <td className="py-1 clr-text truncate" title={h.holder}>
                      {h.holder || 'N/A'}
                    </td>
                    <td className="text-right py-1 clr-text">
                      {h.percentOut !== null
                        ? formatPercent(Math.abs(h.percentOut) > 1 ? h.percentOut / 100 : h.percentOut)
                        : 'N/A'}
                    </td>
                    <td className="text-right py-1 clr-text">{formatShares(h.shares)}</td>
                    <td className="text-right py-1 clr-text">{formatMillions(h.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasInsiders && (
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-2 font-mono clr-muted">
              Recent Insider Transactions
            </div>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="row-b">
                  <th className="text-left py-1 clr-muted font-normal">Insider</th>
                  <th className="text-left py-1 clr-muted font-normal">Action</th>
                  <th className="text-right py-1 clr-muted font-normal">Shares</th>
                  <th className="text-right py-1 clr-muted font-normal">Date</th>
                </tr>
              </thead>
              <tbody>
                {insiders!.slice(0, 8).map((tx, i) => (
                  <tr key={`${tx.insider}-${i}`} className="row-b">
                    <td className="py-1 clr-text truncate" title={`${tx.insider} (${tx.position})`}>
                      {tx.insider || 'N/A'}
                    </td>
                    <td className={`py-1 ${transactionTone(tx.transaction)}`}>
                      {tx.transaction || 'N/A'}
                    </td>
                    <td className="text-right py-1 clr-text">{formatShares(tx.shares)}</td>
                    <td className="text-right py-1 clr-muted text-[10px]">{tx.date || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
