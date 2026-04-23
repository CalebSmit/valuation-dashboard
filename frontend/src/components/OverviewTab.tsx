import type { ValuationRun } from '../types/ValuationRun.ts'
import type { BlendedPriceTarget } from '../types/BlendedOutput.ts'
import { FootballField } from './FootballField.tsx'
import { PriceChart } from './PriceChart.tsx'
import { ReturnHistory } from './ReturnHistory.tsx'
import { DeltaIndicator } from './DeltaIndicator.tsx'
import { formatCurrency, formatMillions, formatPercent, formatMultiple } from '../utils/formatters.ts'

interface OverviewTabProps {
  run: ValuationRun
  blendedOutput: BlendedPriceTarget | null
}

interface KPIItemProps {
  label: string
  value: string
  valueClass?: string
}

function KPIItem({ label, value, valueClass }: KPIItemProps) {
  return (
    <div className="flex flex-col px-4 py-2 kpi-item">
      <span className="text-[10px] uppercase tracking-wider kpi-label">
        {label}
      </span>
      <span className={`text-sm font-semibold ${valueClass ?? 'kpi-value'}`}>
        {value}
      </span>
    </div>
  )
}

export function OverviewTab({ run, blendedOutput }: OverviewTabProps) {
  const data = run.financialData

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Strip */}
      <div className="flex flex-wrap card">
        <KPIItem label="Market Cap" value={formatMillions(data?.marketCap)} />
        <KPIItem label="P/E (TTM)" value={formatMultiple(data?.peRatioTTM)} />
        <KPIItem label="EV/EBITDA" value={formatMultiple(data?.evToEbitda)} />
        <KPIItem label="Beta" value={data?.beta?.toFixed(2) ?? 'N/A'} />
        <KPIItem label="Div Yield" value={data?.dividendYield ? formatPercent(data.dividendYield) : 'N/A'} />
        <KPIItem label="52-Wk High" value={formatCurrency(data?.fiftyTwoWeekHigh)} />
        <KPIItem label="52-Wk Low" value={formatCurrency(data?.fiftyTwoWeekLow)} />
        <KPIItem label="Current" value={formatCurrency(run.currentPrice)} valueClass="kpi-value-amber" />
      </div>

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

      {/* Narrative context */}
      {(data?.businessSummary || run.assumptions?.investment_thesis) && (
        <div className="card p-4 narrative-grid">
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

      {/* Valuation Summary + Implied Prices side-by-side */}
      <div className="flex gap-5 items-stretch">

        {/* Football Field — grows to fill remaining space */}
        <div className="p-4 card valuation-hero flex-1 min-w-0">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
            Valuation Summary
          </h4>
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

        {/* Implied Prices — fixed narrow width */}
        <div className="p-4 card implied-prices-card flex flex-col">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
            Implied Prices
          </h4>
          <table className="w-full text-xs font-mono h-full">
            <thead>
              <tr className="row-b">
                <th className="text-left py-1.5 clr-muted">Method</th>
                <th className="text-right py-1.5 clr-muted">Price</th>
                <th className="text-right py-1.5 clr-muted">vs Now</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  name: 'DCF',
                  price: blendedOutput?.combinedDCFPrice ?? run.dcfOutput?.impliedPrice,
                  previousPrice: run.previousPrices?.dcf ?? null,
                  colorClass: 'clr-accent',
                  weight: blendedOutput?.effectiveModelWeights.dcf ?? null,
                },
                {
                  name: 'DDM',
                  price: run.ddmOutput?.impliedPrice,
                  previousPrice: run.previousPrices?.ddm ?? null,
                  colorClass: 'clr-blue',
                  weight: blendedOutput?.effectiveModelWeights.ddm ?? null,
                },
                {
                  name: 'Comps',
                  price: blendedOutput?.compsPrice ?? run.compsOutput?.weightedImpliedPrice,
                  previousPrice: run.previousPrices?.comps ?? null,
                  colorClass: 'clr-amber',
                  weight: blendedOutput?.effectiveModelWeights.comps ?? null,
                },
              ].map(row => {
                const upside = row.price !== null && row.price !== undefined && run.currentPrice
                  ? (row.price - run.currentPrice) / run.currentPrice
                  : null
                return (
                  <tr key={row.name} className="row-b">
                    <td className={`py-1.5 ${row.colorClass}`}>
                      {row.name}
                      {row.weight !== null && row.weight > 0 && (
                        <span className="ml-1 text-[10px] clr-muted">
                          {Math.round(row.weight * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="text-right py-1.5 clr-text">
                      <div className="flex flex-col items-end gap-0.5">
                        <span>{row.price !== null && row.price !== undefined ? formatCurrency(row.price) : 'N/A'}</span>
                        <DeltaIndicator oldValue={row.previousPrice} newValue={row.price ?? null} />
                      </div>
                    </td>
                    <td className={`text-right py-1.5 ${upside !== null ? (upside > 0 ? 'clr-success' : 'clr-red') : 'clr-muted'}`}>
                      {upside !== null ? `${upside > 0 ? '+' : ''}${(upside * 100).toFixed(1)}%` : 'N/A'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

      </div>

      {/* Key Risks */}
      {run.assumptions?.key_risks && run.assumptions.key_risks.length > 0 && (
        <div className="p-4 card">
          <h4 className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
            Key Risks
          </h4>
          <ul className="flex flex-col gap-1">
            {run.assumptions.key_risks.map((risk, i) => (
              <li key={i} className="text-sm flex gap-2 font-sans clr-text">
                <span className="clr-red">-</span>
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
