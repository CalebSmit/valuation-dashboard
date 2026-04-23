import type { CompsOutput } from '../types/CompsOutput.ts'
import { UpsideLabel } from './UpsideLabel.tsx'
import { CalcBreakdown } from './CalcBreakdown.tsx'
import { formatCurrency, formatMultiple } from '../utils/formatters.ts'

interface CompsTabProps {
  compsOutput: CompsOutput | null
  currentPrice?: number | null
}

/** Horizontal bar showing an implied price vs current price */
function UpsideDownsideBar({
  impliedPrice,
  currentPrice,
  multiple,
}: {
  impliedPrice: number
  currentPrice: number | null
  multiple: string
}) {
  if (!currentPrice || currentPrice <= 0) return null

  const upside = (impliedPrice - currentPrice) / currentPrice
  const isUpside = upside >= 0
  const absPct = Math.abs(upside * 100).toFixed(1)
  const barWidth = Math.min(100, Math.abs(upside) * 100 * 2) // scale 50% upside = full bar

  return (
    <div className="flex items-center gap-2">
      {/* Left side: downside bar grows left */}
      <div className="flex-1 flex items-center justify-end" style={{ minWidth: 60 }}>
        {!isUpside && (
          <div
            className="h-2 rounded-l bg-[#F85149] opacity-70 transition-all"
            style={{ width: `${barWidth}%` }}
          />
        )}
      </div>
      {/* Center: current price line */}
      <div className="w-px h-4 bg-[#F0A500] flex-shrink-0" title={`Current: ${formatCurrency(currentPrice)}`} />
      {/* Right side: upside bar grows right */}
      <div className="flex-1 flex items-center" style={{ minWidth: 60 }}>
        {isUpside && (
          <div
            className="h-2 rounded-r bg-[#00FF88] opacity-70 transition-all"
            style={{ width: `${barWidth}%` }}
          />
        )}
      </div>
      {/* Label */}
      <span className={`text-[10px] font-mono w-14 text-right ${isUpside ? 'text-[#3FB950]' : 'text-[#F85149]'}`}>
        {isUpside ? '+' : ''}{absPct}%
      </span>
    </div>
  )
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
      {/* Peer Multiples Table — subject row highlighted at bottom */}
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
                <tr key={peer.ticker} className="row-b">
                  <td className="py-1.5 clr-accent">{peer.ticker}</td>
                  <td className="py-1.5 cell-truncate">{peer.companyName}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.evToEbitda)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.pe)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.evToSales)}</td>
                  <td className="text-right py-1.5 clr-text">{formatMultiple(peer.pb)}</td>
                </tr>
              ))}
              {/* Median row */}
              <tr className="row-t-amber bg-surface-alt">
                <td className="py-2 font-semibold clr-amber">Median</td>
                <td className="py-2 clr-muted text-[10px]">Peer median</td>
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
              {/* Subject row derived from impliedPrices subjectMetric values */}
              {(() => {
                const evEbitda = compsOutput.impliedPrices.find(ip => ip.multiple === 'EV/EBITDA')?.subjectMetric ?? null
                const pe = compsOutput.impliedPrices.find(ip => ip.multiple === 'P/E')?.subjectMetric ?? null
                const evSales = compsOutput.impliedPrices.find(ip => ip.multiple === 'EV/Sales')?.subjectMetric ?? null
                const pb = compsOutput.impliedPrices.find(ip => ip.multiple === 'P/B')?.subjectMetric ?? null
                const hasAny = evEbitda !== null || pe !== null || evSales !== null || pb !== null
                if (!hasAny) return null
                return (
                  <tr className="row-b border-t-2 border-[#00FF88]/40 bg-[#00FF8808]">
                    <td className="py-2 font-semibold clr-accent">Subject</td>
                    <td className="py-2 clr-muted text-[10px]">vs. median →</td>
                    <td className="text-right py-2 font-semibold clr-accent">{formatMultiple(evEbitda)}</td>
                    <td className="text-right py-2 font-semibold clr-accent">{formatMultiple(pe)}</td>
                    <td className="text-right py-2 font-semibold clr-accent">{formatMultiple(evSales)}</td>
                    <td className="text-right py-2 font-semibold clr-accent">{formatMultiple(pb)}</td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Implied Prices + Upside/Downside Visual */}
      <div className="p-4 card">
        {/* Prominent upside/downside label — first thing the eye sees */}
        <UpsideLabel
          impliedPrice={compsOutput.weightedImpliedPrice}
          currentPrice={currentPrice ?? null}
          modelName="Comps"
        />

        {/* Legend for bar chart */}
        {currentPrice != null && appliedPrices.length > 0 && (
          <div className="flex items-center gap-4 mb-3 text-[10px] font-mono clr-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded bg-[#00FF88] opacity-70" />Upside
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded bg-[#F85149] opacity-70" />Downside
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-px h-4 bg-[#F0A500]" />Current Price
            </span>
          </div>
        )}

        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Implied Price by Multiple
        </h4>
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="row-b">
              <th className="text-left py-2 text-xs clr-muted">Multiple</th>
              <th className="text-right py-2 text-xs clr-muted">Peer Median</th>
              <th className="text-right py-2 text-xs clr-muted">Implied Price</th>
              <th className="py-2 text-xs clr-muted w-48">vs Current</th>
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
                <td className="py-1.5 px-2">
                  {ip.isApplicable && ip.impliedPrice !== null ? (
                    <UpsideDownsideBar
                      impliedPrice={ip.impliedPrice}
                      currentPrice={currentPrice ?? null}
                      multiple={ip.multiple}
                    />
                  ) : (
                    <span className="text-[10px] clr-muted">—</span>
                  )}
                </td>
                <td className={`text-right py-1.5 text-xs ${ip.isApplicable ? 'clr-success' : 'clr-muted'}`}>
                  {ip.isApplicable ? (
                    'Applied'
                  ) : (
                    <span title={ip.reason ?? 'Not applicable'} className="cursor-help border-b border-dotted border-[#8B949E]">
                      N/A
                    </span>
                  )}
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
