import type { PeriodReturns, RiskMetrics } from '../types/FinancialData.ts'

interface ReturnHistoryProps {
  periodReturns: PeriodReturns | null
  riskMetrics: RiskMetrics | null
}

function formatReturnPct(value: number | null): string {
  if (value === null || value === undefined) return 'N/A'
  const pct = value * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatRatio(value: number | null): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toFixed(2)
}

function returnColor(value: number | null): string {
  if (value === null) return 'clr-muted'
  return value >= 0 ? 'clr-success' : 'clr-red'
}

interface RatingBand {
  good: number
  avg: number
}

function ratioColor(value: number | null, band: RatingBand, higherIsBetter: boolean = true): string {
  if (value === null) return 'clr-muted'
  if (higherIsBetter) {
    if (value >= band.good) return 'clr-success'
    if (value >= band.avg) return 'clr-amber'
    return 'clr-red'
  }
  // Lower is better (e.g., volatility)
  if (value <= band.avg) return 'clr-success'
  if (value <= band.good) return 'clr-amber'
  return 'clr-red'
}

const METRIC_TOOLTIPS: Record<string, string> = {
  sharpe: 'Excess return per unit of total risk (volatility). > 1.0 is good.',
  treynor: 'Excess return per unit of systematic risk (beta). Higher is better.',
  sortino: 'Like Sharpe but only penalizes downside volatility. > 1.5 is good.',
  volatility: 'Annualized standard deviation of daily returns.',
}

export function ReturnHistory({ periodReturns, riskMetrics }: ReturnHistoryProps) {
  if (!periodReturns && !riskMetrics) {
    return (
      <div className="p-4 text-center font-mono clr-muted text-[13px]">
        No return data available
      </div>
    )
  }

  const periods: { label: string; key: keyof PeriodReturns }[] = [
    { label: 'YTD', key: 'ytd' },
    { label: '1Y', key: 'oneYear' },
    { label: '3Y', key: 'threeYear' },
    { label: '5Y', key: 'fiveYear' },
  ]

  const riskRows: {
    label: string
    value: string
    colorClass: string
    tooltipKey: string
  }[] = riskMetrics ? [
    {
      label: 'Sharpe Ratio',
      value: formatRatio(riskMetrics.sharpeRatio),
      colorClass: ratioColor(riskMetrics.sharpeRatio, { good: 1.0, avg: 0.5 }),
      tooltipKey: 'sharpe',
    },
    {
      label: 'Treynor Ratio',
      value: formatRatio(riskMetrics.treynorRatio),
      colorClass: ratioColor(riskMetrics.treynorRatio, { good: 0.10, avg: 0.05 }),
      tooltipKey: 'treynor',
    },
    {
      label: 'Sortino Ratio',
      value: formatRatio(riskMetrics.sortinoRatio),
      colorClass: ratioColor(riskMetrics.sortinoRatio, { good: 1.5, avg: 0.5 }),
      tooltipKey: 'sortino',
    },
    {
      label: 'Annl. Volatility',
      value: riskMetrics.annualizedVolatility !== null
        ? `${(riskMetrics.annualizedVolatility * 100).toFixed(1)}%`
        : 'N/A',
      colorClass: ratioColor(riskMetrics.annualizedVolatility, { good: 0.35, avg: 0.20 }, false),
      tooltipKey: 'volatility',
    },
  ] : []

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Period Returns */}
      <div>
        <h5 className="text-[10px] uppercase tracking-wider mb-2 font-mono clr-muted">
          Period Returns
        </h5>
        <div className="flex flex-col gap-1">
          {periods.map(p => {
            const val = periodReturns?.[p.key] ?? null
            return (
              <div key={p.key} className="flex justify-between items-center py-1 row-b">
                <span className="text-xs font-mono clr-muted">{p.label}</span>
                <span className={`text-sm font-semibold font-mono ${returnColor(val)}`}>
                  {formatReturnPct(val)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Risk-Adjusted Metrics */}
      <div>
        <h5 className="text-[10px] uppercase tracking-wider mb-2 font-mono clr-muted">
          Risk-Adjusted Returns
        </h5>
        <div className="flex flex-col gap-1">
          {riskRows.map(row => (
            <div
              key={row.tooltipKey}
              className="flex justify-between items-center py-1 row-b"
              title={METRIC_TOOLTIPS[row.tooltipKey]}
            >
              <span className="text-xs font-mono clr-muted">{row.label}</span>
              <span className={`text-sm font-semibold font-mono ${row.colorClass}`}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
