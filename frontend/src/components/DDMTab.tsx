import { useState } from 'react'
import type { DDMOutput } from '../types/DDMOutput.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { DividendMetricsDetail } from '../types/FinancialData.ts'
import type { DataOverrides } from '../hooks/useDataOverrides.ts'
import { AssumptionField } from './AssumptionField.tsx'
import { DataField } from './DataField.tsx'
import { UpsideLabel } from './UpsideLabel.tsx'
import { CalcBreakdown } from './CalcBreakdown.tsx'
import { formatCurrency, formatPercent } from '../utils/formatters.ts'
import { BOUNDS } from '../utils/constants.ts'

// Plain-English tooltips for DDM-specific fields
const TOOLTIPS = {
  requiredReturn:
    'The minimum annual return a shareholder expects to justify holding this stock — calculated using CAPM (risk-free rate + beta × equity risk premium). It\'s the discount rate for dividends.',
  shortTermGrowth:
    'How fast dividends are expected to grow in the near term (typically 5 years). Usually based on analyst forecasts or the company\'s recent dividend growth history.',
  longTermGrowth:
    'The sustainable dividend growth rate in perpetuity — must be below the required return or the model breaks down. Often set near GDP growth (2–3%).',
  payoutRatio:
    'The percentage of earnings paid out as dividends. A 40% payout ratio means the company pays $0.40 of every $1.00 earned as dividends and retains the rest.',
}

interface DDMTabProps {
  ddmOutput: DDMOutput | null
  assumptions: Assumptions | null
  currentDPS: number | null
  originalDPS: number | null
  currentPrice?: number | null
  dividendMetrics?: DividendMetricsDetail
  onOverride: (path: string, value: number) => void
  onDataOverride: (field: keyof DataOverrides, value: number) => void
}

function confidenceBanner(score: number): { label: string; className: string } {
  if (score >= 4) return { label: 'DDM is well-suited for this company', className: 'clr-success' }
  if (score >= 3) return { label: 'DDM is moderately applicable — review failed criteria', className: 'clr-amber' }
  return { label: 'DDM has limited applicability — consider reducing DDM model weight', className: 'clr-muted' }
}

export function DDMTab({ ddmOutput, assumptions, currentDPS, originalDPS, currentPrice, dividendMetrics, onOverride, onDataOverride }: DDMTabProps) {
  const [showInputs, setShowInputs] = useState(false)

  if (!ddmOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No DDM data available</div>
  }

  const banner = confidenceBanner(ddmOutput.applicabilityScore)
  const hasResults = ddmOutput.isApplicable && (ddmOutput.singleStagePrice !== null || ddmOutput.twoStagePrice !== null)
  const isApplicable = ddmOutput.isApplicable

  // Build DDM calculation breakdown
  const dps = currentDPS ?? ddmOutput.currentDPS
  const ke = ddmOutput.requiredReturn
  const gLt = ddmOutput.longTermGrowth

  const singleStageBreakdown = dps !== null && ke !== null && gLt !== null ? (
    <span>
      <span className="text-slate-400">Single-Stage Gordon Growth:</span>{' '}
      <span className="text-green-400">P = DPS / (ke − g)</span>{' '}
      <span className="text-slate-400">= {formatCurrency(dps)} / ({formatPercent(ke)} − {formatPercent(gLt)})</span>{' '}
      {ddmOutput.singleStagePrice !== null && (
        <span className="text-amber-400 font-semibold">= {formatCurrency(ddmOutput.singleStagePrice)}/share</span>
      )}
      {ddmOutput.twoStagePrice !== null && (
        <>
          {'  |  '}
          <span className="text-slate-400">Two-Stage: PV of near-term dividends + PV of terminal value</span>{' '}
          <span className="text-amber-400 font-semibold">= {formatCurrency(ddmOutput.twoStagePrice)}/share</span>
        </>
      )}
    </span>
  ) : (
    <span className="text-slate-400">Insufficient data to display formula.</span>
  )

  // Dividend metrics quick-summary — pulled from DDM_Metrics sheet.
  // Use Number.isFinite so undefined and NaN don't slip through the
  // `!== null` checks and crash `.toFixed` calls below.
  const dm = dividendMetrics
  const showDividendMetrics = !!dm && (
    Number.isFinite(dm.annualDividendRate as number)
    || Number.isFinite(dm.currentDividendYieldPct as number)
    || Number.isFinite(dm.fiveYearCagrPct as number)
    || (Number.isFinite(dm.yearsOfHistory as number) && (dm.yearsOfHistory as number) > 0)
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Dividend Metrics summary — sustainability snapshot ahead of applicability */}
      {showDividendMetrics && (
        <div className="p-3 card">
          <h4 className="text-xs uppercase tracking-wider mb-2 font-mono clr-muted">
            Dividend Metrics
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div>
              <div className="text-[10px] uppercase tracking-wider clr-muted">Yield</div>
              <div className="clr-text text-sm font-semibold">
                {Number.isFinite(dm.currentDividendYieldPct as number)
                  ? `${(dm.currentDividendYieldPct as number).toFixed(2)}%`
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider clr-muted">Payout Ratio</div>
              <div className="clr-text text-sm font-semibold">
                {Number.isFinite(dm.payoutRatioPct as number)
                  ? `${(dm.payoutRatioPct as number).toFixed(1)}%`
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider clr-muted">5Y CAGR</div>
              <div className={`text-sm font-semibold ${
                !Number.isFinite(dm.fiveYearCagrPct as number) ? 'clr-muted'
                  : (dm.fiveYearCagrPct as number) > 0 ? 'text-[#3FB950]'
                  : 'text-[#F85149]'
              }`}>
                {Number.isFinite(dm.fiveYearCagrPct as number)
                  ? `${(dm.fiveYearCagrPct as number).toFixed(2)}%`
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider clr-muted">History</div>
              <div className="clr-text text-sm font-semibold">
                {Number.isFinite(dm.yearsOfHistory as number)
                  ? `${Math.round(dm.yearsOfHistory as number)}y · ${dm.paymentFrequency || 'N/A'}`
                  : (dm.paymentFrequency || 'N/A')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Applicability Checklist */}
      <div className="p-4 card">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
            DDM Applicability ({ddmOutput.applicabilityScore}/4 criteria)
          </h4>
          <span className={`text-xs font-mono ${banner.className}`}>
            {banner.label}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {ddmOutput.applicabilityCriteria.map((c, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              <span className={`w-5 h-5 flex items-center justify-center text-xs font-bold font-mono ${c.pass ? 'criteria-pass' : 'criteria-fail'}`}>
                {c.pass ? 'P' : 'F'}
              </span>
              <div className="flex-1">
                <span className="text-sm font-mono clr-text">
                  {c.name}
                </span>
                <span className="ml-2 text-xs font-mono clr-muted">
                  {c.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Not Applicable state — dominant message, inputs behind toggle */}
      {!isApplicable && (
        <div className="p-5 card border border-[#F0A500]/30 bg-[#F0A500]/5 text-center">
          <p className="font-mono text-base clr-amber font-semibold mb-1">DDM Not Applicable</p>
          <p className="font-mono text-sm clr-muted mb-4">
            This company does not meet the minimum criteria for a dividend discount model. The DDM model weight should be reduced toward 0 in the weighting panel.
          </p>
          <button
            type="button"
            onClick={() => setShowInputs(s => !s)}
            className="text-xs font-mono border border-[#30363D] px-3 py-1.5 rounded clr-muted hover:clr-text transition-colors"
          >
            {showInputs ? 'Hide DDM inputs' : 'Show DDM inputs anyway'}
          </button>
        </div>
      )}

      {/* DDM Results or collapsed inputs */}
      {(isApplicable || showInputs) && (
        <>
          {hasResults ? (
            <>
              {/* Side-by-side implied price comparison cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ddmOutput.singleStagePrice !== null && (
                  <div className="card p-4 border border-[#4493F8]/30 bg-[#4493F8]/5">
                    <div className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-1">Single-Stage DDM</div>
                    <div className="text-2xl font-bold font-mono clr-blue">{formatCurrency(ddmOutput.singleStagePrice)}</div>
                    {currentPrice != null && (
                      <div className={`text-xs font-mono mt-1 ${ddmOutput.singleStagePrice > currentPrice ? 'clr-success' : 'clr-red'}`}>
                        {ddmOutput.singleStagePrice > currentPrice ? '+' : ''}
                        {(((ddmOutput.singleStagePrice - currentPrice) / currentPrice) * 100).toFixed(1)}% vs current
                      </div>
                    )}
                    <div className="text-[10px] clr-muted mt-2 font-mono">P = D₁ / (ke − g∞)</div>
                  </div>
                )}
                {ddmOutput.twoStagePrice !== null && (
                  <div className="card p-4 border border-[#00FF88]/30 bg-[#00FF88]/5">
                    <div className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-1">Two-Stage DDM</div>
                    <div className="text-2xl font-bold font-mono clr-accent">{formatCurrency(ddmOutput.twoStagePrice)}</div>
                    {currentPrice != null && (
                      <div className={`text-xs font-mono mt-1 ${ddmOutput.twoStagePrice > currentPrice ? 'clr-success' : 'clr-red'}`}>
                        {ddmOutput.twoStagePrice > currentPrice ? '+' : ''}
                        {(((ddmOutput.twoStagePrice - currentPrice) / currentPrice) * 100).toFixed(1)}% vs current
                      </div>
                    )}
                    <div className="text-[10px] clr-muted mt-2 font-mono">PV(near-term divs) + PV(terminal)</div>
                  </div>
                )}
              </div>

              {/* Full DDM inputs */}
              <div className="p-4 card">
                <UpsideLabel
                  impliedPrice={ddmOutput.impliedPrice}
                  currentPrice={currentPrice ?? null}
                  modelName="DDM"
                />
                <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
                  DDM Inputs
                </h4>
                <table className="w-full text-sm font-mono">
                  <tbody>
                    <tr className="row-b"><td colSpan={2}>
                      <DataField label="Current DPS" value={currentDPS} originalValue={originalDPS} format="currency" onOverride={v => onDataOverride('annualDividendRate', v)} />
                    </td></tr>
                    {assumptions?.ddm.required_return && (
                      <tr className="row-b"><td colSpan={2}>
                        <AssumptionField
                          label="Required Return (ke)"
                          assumption={assumptions.ddm.required_return}
                          format="percent"
                          onOverride={v => onOverride('ddm.required_return', v)}
                          min={BOUNDS.requiredReturn.min}
                          max={BOUNDS.requiredReturn.max}
                          tooltip={TOOLTIPS.requiredReturn}
                        />
                      </td></tr>
                    )}
                    {assumptions?.ddm.short_term_growth_rate && (
                      <tr className="row-b"><td colSpan={2}>
                        <AssumptionField
                          label="Short-Term Growth"
                          assumption={assumptions.ddm.short_term_growth_rate}
                          format="percent"
                          onOverride={v => onOverride('ddm.short_term_growth_rate', v)}
                          min={BOUNDS.dividendGrowthRate.min}
                          max={BOUNDS.dividendGrowthRate.max}
                          tooltip={TOOLTIPS.shortTermGrowth}
                        />
                      </td></tr>
                    )}
                    {assumptions?.ddm.long_term_growth_rate && (
                      <tr className="row-b"><td colSpan={2}>
                        <AssumptionField
                          label="Long-Term Growth"
                          assumption={assumptions.ddm.long_term_growth_rate}
                          format="percent"
                          onOverride={v => onOverride('ddm.long_term_growth_rate', v)}
                          min={BOUNDS.terminalGrowthRate.min}
                          max={BOUNDS.terminalGrowthRate.max}
                          tooltip={TOOLTIPS.longTermGrowth}
                        />
                      </td></tr>
                    )}
                  </tbody>
                </table>
                {/* How this was calculated */}
                <CalcBreakdown formula={singleStageBreakdown} />
              </div>

              {/* DPS Projections table */}
              {ddmOutput.dpsProjections.length > 0 && (
                <div className="p-4 card">
                  <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
                    Dividend Per Share Projections
                  </h4>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="row-b">
                        <th className="text-left py-2 clr-muted">Year</th>
                        <th className="text-right py-2 clr-muted">DPS</th>
                        <th className="text-right py-2 clr-muted">Growth</th>
                        <th className="text-right py-2 clr-muted">PV of DPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ddmOutput.dpsProjections.map(p => (
                        <tr key={p.year} className="row-b">
                          <td className="py-1.5 clr-text">Y{p.year}</td>
                          <td className="text-right py-1.5 clr-text">{formatCurrency(p.dps)}</td>
                          <td className="text-right py-1.5 clr-blue">{formatPercent(p.growthRate)}</td>
                          <td className="text-right py-1.5 clr-accent">{formatCurrency(p.pvDPS)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="p-4 text-center card">
              <p className="font-mono text-sm clr-muted">
                DDM cannot be computed for this company.
              </p>
              <p className="font-mono text-xs mt-1 clr-muted">
                The company does not pay dividends or has zero dividend per share.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
