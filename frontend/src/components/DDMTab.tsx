import type { DDMOutput } from '../types/DDMOutput.ts'
import type { Assumptions } from '../types/Assumptions.ts'
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
  onOverride: (path: string, value: number) => void
  onDataOverride: (field: keyof DataOverrides, value: number) => void
}

function confidenceBanner(score: number): { label: string; className: string } {
  if (score >= 4) return { label: 'DDM is well-suited for this company', className: 'clr-success' }
  if (score >= 3) return { label: 'DDM is moderately applicable — review failed criteria', className: 'clr-amber' }
  return { label: 'DDM has limited applicability — consider reducing DDM model weight', className: 'clr-muted' }
}

export function DDMTab({ ddmOutput, assumptions, currentDPS, originalDPS, currentPrice, onOverride, onDataOverride }: DDMTabProps) {
  if (!ddmOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No DDM data available</div>
  }

  const banner = confidenceBanner(ddmOutput.applicabilityScore)
  const hasResults = ddmOutput.isApplicable && (ddmOutput.singleStagePrice !== null || ddmOutput.twoStagePrice !== null)

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

  return (
    <div className="flex flex-col gap-5">
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

      {/* DDM Results — shown whenever the engine produced prices */}
      {hasResults ? (
        <>
          <div className="p-4 card">
            {/* Prominent upside/downside label — first thing the eye sees */}
            <UpsideLabel
              impliedPrice={ddmOutput.impliedPrice}
              currentPrice={currentPrice ?? null}
              modelName="DDM"
            />
            <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
              DDM Valuation
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
                <tr className="row-t-blue">
                  <td className="py-2 text-xs font-semibold clr-blue">Single-Stage Price</td>
                  <td className="text-right py-2 font-bold clr-blue">{formatCurrency(ddmOutput.singleStagePrice)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-xs font-semibold clr-blue">Two-Stage Price</td>
                  <td className="text-right py-2 font-bold clr-blue">{formatCurrency(ddmOutput.twoStagePrice)}</td>
                </tr>
              </tbody>
            </table>
            {/* How this was calculated */}
            <CalcBreakdown formula={singleStageBreakdown} />
          </div>

          {/* DPS Projections */}
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
    </div>
  )
}
