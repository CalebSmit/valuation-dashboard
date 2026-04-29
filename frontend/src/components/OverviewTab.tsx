import type { ValuationRun } from '../types/ValuationRun.ts'
import type { BlendedPriceTarget } from '../types/BlendedOutput.ts'
import { FootballField } from './FootballField.tsx'
import { PriceChart } from './PriceChart.tsx'
import { ReturnHistory } from './ReturnHistory.tsx'
import { OwnershipCard } from './OwnershipCard.tsx'
import { RecentDevelopmentsCard } from './RecentDevelopmentsCard.tsx'
import { EarningsStripCard } from './EarningsStripCard.tsx'
import { formatCurrency, formatMillions, formatPercent, formatMultiple } from '../utils/formatters.ts'

interface OverviewTabProps {
  run: ValuationRun
  blendedOutput: BlendedPriceTarget | null
}

interface KPIItemProps {
  label: string
  value: string
  valueClass?: string
  title?: string
}

function KPIItem({ label, value, valueClass, title }: KPIItemProps) {
  return (
    <div className="flex flex-col px-3 py-2 kpi-item min-w-0" title={title}>
      <span className="text-[10px] uppercase tracking-wider kpi-label whitespace-nowrap">
        {label}
      </span>
      <span className={`text-sm font-semibold truncate ${valueClass ?? 'kpi-value'}`}>
        {value}
      </span>
    </div>
  )
}

export function OverviewTab({ run, blendedOutput }: OverviewTabProps) {
  const data = run.financialData

  // 52-wk tooltip for Current Price KPI
  const priceTooltip = data?.fiftyTwoWeekHigh != null && data?.fiftyTwoWeekLow != null
    ? `52-wk High: ${formatCurrency(data.fiftyTwoWeekHigh)} / 52-wk Low: ${formatCurrency(data.fiftyTwoWeekLow)}`
    : undefined

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Strip — 4 cols mobile, 8 desktop */}
      <div className="grid grid-cols-4 sm:grid-cols-8 card overflow-hidden">
        <KPIItem label="Market Cap" value={formatMillions(data?.marketCap)} />
        <KPIItem label="P/E (TTM)" value={formatMultiple(data?.peRatioTTM)} />
        <KPIItem label="EV/EBITDA" value={formatMultiple(data?.evToEbitda)} />
        <KPIItem label="Beta" value={data?.beta?.toFixed(2) ?? 'N/A'} />
        <KPIItem label="Div Yield" value={data?.dividendYield ? formatPercent(data.dividendYield) : 'N/A'} />
        {/* Revenue TTM replacing 52-wk High */}
        <KPIItem label="Rev TTM" value={formatMillions(data?.revenueLatest)} />
        {/* Free Cash Flow replacing 52-wk Low */}
        <KPIItem label="FCF" value={data?.freeCashFlow != null ? formatMillions(data.freeCashFlow) : 'N/A'} />
        {/* Current price shows 52-wk range on hover */}
        <KPIItem
          label="Current"
          value={formatCurrency(run.currentPrice)}
          valueClass="kpi-value-amber"
          title={priceTooltip}
        />
      </div>

      {/* Earnings strip — next date + recent surprise track record */}
      <EarningsStripCard
        calendar={data?.earningsCalendar}
        summary={data?.earningsSurpriseSummary}
      />

      {/* Historical Price Chart + Forecast */}
      {data?.stockPriceHistory && data.stockPriceHistory.length > 0 && (
        <div className="p-4 card">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
            Price History & Forecast
          </h4>
          <PriceChart
            priceHistory={data.stockPriceHistory}
            currentPrice={run.currentPrice}
            fiftyTwoWeekHigh={data.fiftyTwoWeekHigh}
            fiftyTwoWeekLow={data.fiftyTwoWeekLow}
            bullTarget={run.scenarioOutput?.bull.weightedPrice ?? null}
            baseTarget={blendedOutput?.finalPrice ?? null}
            bearTarget={run.scenarioOutput?.bear.weightedPrice ?? null}
          />
        </div>
      )}

      {/* Ownership signals — top institutional holders + insider activity */}
      <OwnershipCard
        holders={data?.institutionalHolders}
        insiders={data?.insiderTransactions}
        concentration={data?.ownershipConcentration}
      />

      {/* Recent news headlines */}
      <RecentDevelopmentsCard news={data?.recentNews} />

      {/* Return History & Risk Metrics */}
      {(data?.periodReturns || data?.riskMetrics) && (
        <div className="p-4 card">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
            Return History & Risk Metrics
          </h4>
          <ReturnHistory
            periodReturns={data?.periodReturns ?? null}
            riskMetrics={data?.riskMetrics ?? null}
          />
        </div>
      )}

      {/* Narrative context — side by side on desktop */}
      {(data?.businessSummary || run.assumptions?.investment_thesis) && (
        <div className="card p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
          {run.assumptions?.investment_thesis && (
            <div>
              <h4 className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
                Investment Thesis
              </h4>
              <p className="text-sm leading-relaxed font-sans clr-text narrative-clamp">
                {run.assumptions.investment_thesis}
              </p>
            </div>
          )}
          {data?.businessSummary && (
            <div>
              <h4 className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
                Business Context
              </h4>
              <p className="text-sm leading-relaxed font-sans clr-text narrative-clamp">
                {data.businessSummary}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Football Field — visual centerpiece, no duplicate implied prices table */}
      <div className="p-4 card valuation-hero">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Valuation Summary
        </h4>

        {/* Surface when the blended price is computed from fewer than the
            three available models — otherwise a comps wipeout silently
            produces a price that's 30–50% off without any visible cue. */}
        {(() => {
          const dcfOk = run.dcfOutput?.impliedPrice != null && run.dcfOutput.impliedPrice > 0
          const compsOk = run.compsOutput?.weightedImpliedPrice != null && run.compsOutput.weightedImpliedPrice > 0
          const ddmOk = run.ddmOutput?.impliedPrice != null && run.ddmOutput.impliedPrice > 0
          const okCount = [dcfOk, compsOk, ddmOk].filter(Boolean).length
          if (okCount === 0 || okCount === 3) return null
          const failed: string[] = []
          if (!dcfOk) failed.push('DCF')
          if (!compsOk) failed.push('Comps')
          if (!ddmOk) failed.push('DDM')
          return (
            <div className="mb-3 p-2 rounded text-xs font-mono border border-[#F0A500] text-[#F0A500] bg-[#F0A500]/10">
              Blended fair value uses {okCount} of 3 models — {failed.join(', ')}
              {' '}did not produce a usable price. The blend may not represent a full triangulation.
              {!compsOk && (run.compsOutput?.failedPeers ?? 0) > 0 && (
                <> Peer data failed for {run.compsOutput?.failedPeers} ticker
                {run.compsOutput?.failedPeers === 1 ? '' : 's'}; try Analyze again in 60s.</>
              )}
            </div>
          )
        })()}

        <FootballField
          dcfOutput={run.dcfOutput}
          ddmOutput={run.ddmOutput}
          compsOutput={run.compsOutput}
          scenarioOutput={run.scenarioOutput}
          currentPrice={run.currentPrice}
          fiftyTwoWeekHigh={data?.fiftyTwoWeekHigh ?? null}
          fiftyTwoWeekLow={data?.fiftyTwoWeekLow ?? null}
          priceTarget={blendedOutput?.finalPrice ?? null}
        />
      </div>

      {/* Key Risks — styled pills */}
      {run.assumptions?.key_risks && run.assumptions.key_risks.length > 0 && (
        <div className="p-4 card">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
            Key Risks
          </h4>
          <div className="flex flex-wrap gap-2">
            {run.assumptions.key_risks.map((risk, i) => (
              <span
                key={i}
                className="px-2.5 py-1 text-xs font-mono rounded-full border risk-pill"
              >
                {risk}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
