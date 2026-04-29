import type { OptionsSummary, RiskMetrics } from '../types/FinancialData.ts'
import { formatPercent } from '../utils/formatters.ts'

interface OptionsImpliedVolCardProps {
  options: OptionsSummary | undefined
  riskMetrics: RiskMetrics | null | undefined
}

function _num(value: number | null | undefined): number | null {
  return Number.isFinite(value as number) ? (value as number) : null
}

function avg(a: number | null | undefined, b: number | null | undefined): number | null {
  const av = _num(a)
  const bv = _num(b)
  if (av === null && bv === null) return null
  if (av === null) return bv
  if (bv === null) return av
  return (av + bv) / 2
}

export function OptionsImpliedVolCard({ options, riskMetrics }: OptionsImpliedVolCardProps) {
  if (!options) return null
  const meanIV = avg(options.avgCallIV, options.avgPutIV)
  const pcVolume = _num(options.putCallVolumeRatio)
  const pcOI = _num(options.putCallOpenInterestRatio)
  if (meanIV === null && pcVolume === null && pcOI === null) {
    return null
  }

  const realizedVol = _num(riskMetrics?.annualizedVolatility ?? null)
  const ivVsRealized = meanIV !== null && realizedVol !== null
    ? meanIV - realizedVol
    : null

  const interpretation = (() => {
    if (ivVsRealized === null) return null
    if (Math.abs(ivVsRealized) < 0.05) {
      return 'Options pricing roughly in line with realized vol — WACC reasonable.'
    }
    if (ivVsRealized > 0) {
      return `Implied vol exceeds realized by ${formatPercent(ivVsRealized)} — market is pricing more risk than the historical track record suggests; consider lifting beta or size premium.`
    }
    return `Implied vol is below realized by ${formatPercent(Math.abs(ivVsRealized))} — market is calmer than recent history; check for option market complacency.`
  })()

  const pcRatio = pcVolume ?? pcOI
  const sentimentLabel = (() => {
    if (pcRatio === null) return null
    if (pcRatio > 1.2) return { text: 'Bearish skew', tone: 'text-[#F85149]' }
    if (pcRatio < 0.7) return { text: 'Bullish skew', tone: 'text-[#3FB950]' }
    return { text: 'Neutral', tone: 'clr-text' }
  })()

  return (
    <div className="p-3 card">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
          Options-Implied Volatility
        </h4>
        {options.nearestExpiry && (
          <span className="text-[10px] font-mono clr-muted">
            Nearest expiry: {options.nearestExpiry}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Avg Call IV</div>
          <div className="clr-text text-sm font-semibold">
            {Number.isFinite(options.avgCallIV as number)
              ? formatPercent(options.avgCallIV as number)
              : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Avg Put IV</div>
          <div className="clr-text text-sm font-semibold">
            {Number.isFinite(options.avgPutIV as number)
              ? formatPercent(options.avgPutIV as number)
              : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Realized Vol (5y)</div>
          <div className="clr-text text-sm font-semibold">
            {realizedVol !== null ? formatPercent(realizedVol) : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Put/Call (vol)</div>
          <div className={`text-sm font-semibold ${sentimentLabel?.tone ?? 'clr-text'}`}>
            {pcVolume !== null
              ? pcVolume.toFixed(2)
              : pcOI !== null
                ? `${pcOI.toFixed(2)} (OI)`
                : 'N/A'}
            {sentimentLabel && (
              <span className="ml-1 text-[10px] font-normal">{sentimentLabel.text}</span>
            )}
          </div>
        </div>
      </div>

      {interpretation && (
        <p className="text-[11px] font-sans clr-muted leading-relaxed">{interpretation}</p>
      )}
    </div>
  )
}
