import type {
  EarningsCalendar,
  EarningsSurpriseSummary,
} from '../types/FinancialData.ts'
import { formatCurrency, formatMillions } from '../utils/formatters.ts'

interface EarningsStripCardProps {
  calendar: EarningsCalendar | undefined
  summary: EarningsSurpriseSummary | undefined
}

function formatSurprisePct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A'
  // surprisePercent comes through in percentage form (e.g. 4.32 = +4.32%)
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function EarningsStripCard({ calendar, summary }: EarningsStripCardProps) {
  const hasCalendar = calendar && calendar.nextEarningsDate
  const hasSummary = summary && (summary.beats > 0 || summary.misses > 0 || summary.lastSurprisePct !== null)
  if (!hasCalendar && !hasSummary) return null

  const nextDate = calendar?.nextEarningsDate ?? null
  const epsEst = calendar?.epsEstimate ?? null
  const revEst = calendar?.revenueEstimate ?? null

  const beats = summary?.beats ?? 0
  const misses = summary?.misses ?? 0
  const total = beats + misses
  const beatRate = total > 0 ? `${beats}/${total}` : 'N/A'
  const lastSurprise = summary?.lastSurprisePct ?? null
  const avgSurprise = summary?.averageSurprisePct ?? null

  return (
    <div className="p-3 card">
      <h4 className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
        Earnings
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Next Date</div>
          <div className="clr-accent text-sm font-semibold">{nextDate ?? 'N/A'}</div>
          {(epsEst !== null || revEst !== null) && (
            <div className="clr-muted text-[10px] mt-0.5">
              {epsEst !== null && <span>EPS est: {formatCurrency(epsEst)}</span>}
              {epsEst !== null && revEst !== null && <span> · </span>}
              {revEst !== null && <span>Rev: {formatMillions(revEst)}</span>}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Beat Rate (4Q)</div>
          <div className="clr-text text-sm font-semibold">{beatRate}</div>
          <div className="clr-muted text-[10px] mt-0.5">
            {beats} beat · {misses} miss
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Last Surprise</div>
          <div className={`text-sm font-semibold ${
            lastSurprise === null ? 'clr-muted'
              : lastSurprise > 0 ? 'text-[#3FB950]'
              : lastSurprise < 0 ? 'text-[#F85149]'
              : 'clr-text'
          }`}>
            {formatSurprisePct(lastSurprise)}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider clr-muted">Avg Surprise (4Q)</div>
          <div className={`text-sm font-semibold ${
            avgSurprise === null ? 'clr-muted'
              : avgSurprise > 0 ? 'text-[#3FB950]'
              : avgSurprise < 0 ? 'text-[#F85149]'
              : 'clr-text'
          }`}>
            {formatSurprisePct(avgSurprise)}
          </div>
        </div>
      </div>
    </div>
  )
}
