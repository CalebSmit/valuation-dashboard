import type { ScenarioOutput } from '../types/ScenarioOutput.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import { useState } from 'react'
import { AssumptionField } from './AssumptionField.tsx'
import { formatCurrency } from '../utils/formatters.ts'
import { DEFAULT_SCENARIO_PROBABILITIES } from '../utils/constants.ts'

interface ScenariosTabProps {
  scenarioOutput: ScenarioOutput | null
  assumptions: Assumptions | null
  onOverride: (path: string, value: number) => void
}

type ScenarioKey = 'revenue_growth' | 'ebitda_margin' | 'exit_multiple' | 'wacc'

const DRIVER_CONFIG: { key: ScenarioKey; label: string; format: 'percent' | 'multiple' }[] = [
  { key: 'revenue_growth', label: 'Revenue Growth', format: 'percent' },
  { key: 'ebitda_margin', label: 'EBITDA Margin', format: 'percent' },
  { key: 'exit_multiple', label: 'Exit Multiple', format: 'multiple' },
  { key: 'wacc', label: 'WACC Adjustment', format: 'percent' },
]

/** Horizontal scenario range bar */
function ScenarioRangeBar({
  bearPrice,
  basePrice,
  bullPrice,
  currentPrice,
}: {
  bearPrice: number | null
  basePrice: number | null
  bullPrice: number | null
  currentPrice: number | null
}) {
  if (!bearPrice || !bullPrice) return null

  const min = Math.min(bearPrice, currentPrice ?? bearPrice) * 0.95
  const max = Math.max(bullPrice, currentPrice ?? bullPrice) * 1.05
  const range = max - min
  if (range <= 0) return null

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100))

  const bearPct = pct(bearPrice)
  const bullPct = pct(bullPrice)
  const basePct = basePrice !== null ? pct(basePrice) : null
  const currPct = currentPrice !== null ? pct(currentPrice) : null

  return (
    <div className="mt-4">
      <div className="text-[10px] font-mono clr-muted uppercase tracking-wider mb-2">Bear → Bull Range</div>

      {/* Track */}
      <div className="relative h-6 rounded" style={{ background: '#0D1117', border: '1px solid #30363D' }}>
        {/* Filled range between bear and bull */}
        <div
          className="absolute top-0 h-full rounded bg-gradient-to-r from-[#F85149] via-[#F0A500] to-[#3FB950]"
          style={{
            left: `${bearPct}%`,
            width: `${bullPct - bearPct}%`,
            opacity: 0.3,
          }}
        />

        {/* Bear marker */}
        <div className="absolute top-0 h-full flex items-center" style={{ left: `${bearPct}%`, transform: 'translateX(-50%)' }}>
          <div className="w-1 h-full bg-[#F85149] rounded" />
        </div>

        {/* Bull marker */}
        <div className="absolute top-0 h-full flex items-center" style={{ left: `${bullPct}%`, transform: 'translateX(-50%)' }}>
          <div className="w-1 h-full bg-[#3FB950] rounded" />
        </div>

        {/* Base marker */}
        {basePct !== null && (
          <div className="absolute top-0 h-full flex items-center" style={{ left: `${basePct}%`, transform: 'translateX(-50%)' }}>
            <div className="w-0.5 h-full bg-[#E6EDF3]" />
          </div>
        )}

        {/* Current price tick */}
        {currPct !== null && (
          <div className="absolute top-[-4px] h-[calc(100%+8px)] flex items-center" style={{ left: `${currPct}%`, transform: 'translateX(-50%)' }}>
            <div className="w-0.5 h-full bg-[#F0A500]" style={{ boxShadow: '0 0 4px #F0A500' }} />
          </div>
        )}
      </div>

      {/* Labels below track */}
      <div className="relative h-8 mt-1">
        <span className="absolute text-[10px] font-mono text-[#F85149]" style={{ left: `${bearPct}%`, transform: 'translateX(-50%)' }}>
          Bear<br />{formatCurrency(bearPrice)}
        </span>
        {basePct !== null && basePrice !== null && (
          <span className="absolute text-[10px] font-mono clr-text" style={{ left: `${basePct}%`, transform: 'translateX(-50%)' }}>
            Base<br />{formatCurrency(basePrice)}
          </span>
        )}
        {currPct !== null && currentPrice !== null && (
          <span className="absolute text-[10px] font-mono text-[#F0A500]" style={{ left: `${currPct}%`, transform: 'translateX(-50%)' }}>
            Now<br />{formatCurrency(currentPrice)}
          </span>
        )}
        <span className="absolute text-[10px] font-mono text-[#3FB950]" style={{ left: `${bullPct}%`, transform: 'translateX(-50%)' }}>
          Bull<br />{formatCurrency(bullPrice)}
        </span>
      </div>
    </div>
  )
}

const scenarioClasses = {
  bear: 'clr-red',
  base: 'clr-text',
  bull: 'clr-success',
} as const

export function ScenariosTab({ scenarioOutput, assumptions, onOverride }: ScenariosTabProps) {
  const [activeSlider, setActiveSlider] = useState<string | null>(null)

  if (!scenarioOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No scenario data available</div>
  }

  const scenarios = assumptions?.scenarios
  const probabilities = scenarios?.probabilities ?? DEFAULT_SCENARIO_PROBABILITIES
  const probabilityTotal = Object.values(probabilities).reduce((sum, value) => sum + value, 0)
  const probsValid = Math.abs(probabilityTotal - 1) <= 0.01

  const spread = scenarioOutput.bull.weightedPrice !== null && scenarioOutput.bear.weightedPrice !== null
    ? scenarioOutput.bull.weightedPrice - scenarioOutput.bear.weightedPrice
    : null

  // Probability of upside: sum of weights for scenarios where price > currentPrice
  // We use the scenario expected price vs a rough current price proxy
  const baseProb = probabilities.base ?? 0
  const bullProb = probabilities.bull ?? 0

  // Current price is not directly in ScenariosTab props — use expectedPrice vs bear/base/bull
  // A positive probability of upside = scenarios where weighted price exceeds expected price
  // (We approximate as: probability that selected scenario beats bear scenario)
  // Better: probability upside = bull + base if both have price > bear
  const probUpside = bullProb + (scenarioOutput.base.weightedPrice !== null && scenarioOutput.bear.weightedPrice !== null && scenarioOutput.base.weightedPrice > scenarioOutput.bear.weightedPrice ? baseProb : 0)

  return (
    <div className="flex flex-col gap-5">
      {/* First-glance risk read */}
      <div className="card p-4 scenario-glance">
        <div className="scenario-glance-eyebrow">First-glance risk read</div>
        <div className="scenario-glance-grid">
          <div>
            <div className="scenario-glance-label">Expected Value</div>
            <div className="scenario-glance-main clr-amber">{formatCurrency(scenarioOutput.expectedPrice)}</div>
          </div>
          <div>
            <div className="scenario-glance-label">Bear to Bull Range</div>
            <div className="scenario-glance-main">{formatCurrency(spread)}</div>
          </div>
          <div>
            <div className="scenario-glance-label">Probabilities Sum</div>
            <div className={`scenario-glance-main ${probsValid ? 'clr-success' : 'clr-amber'}`}>
              {(probabilityTotal * 100).toFixed(0)}%
              {!probsValid && <span className="text-[10px] ml-1 clr-amber">(≠ 100%)</span>}
            </div>
          </div>
          <div>
            <div className="scenario-glance-label">Prob. of Upside</div>
            <div className="scenario-glance-main clr-success">
              {(probUpside * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Range bar — the visual centerpiece */}
        <ScenarioRangeBar
          bearPrice={scenarioOutput.bear.weightedPrice}
          basePrice={scenarioOutput.base.weightedPrice}
          bullPrice={scenarioOutput.bull.weightedPrice}
          currentPrice={null}
        />
      </div>

      {/* Probability Sliders */}
      <div className="p-4 card">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
            Scenario Probabilities
          </h4>
          <span className={`text-xs font-mono flex items-center gap-2 ${probsValid ? 'clr-success' : 'text-[#F85149]'}`}>
            {!probsValid && <span className="text-[#F85149]">⚠</span>}
            Total: {(probabilityTotal * 100).toFixed(0)}%
            {!probsValid && <span className="text-[10px] text-[#F85149]">must equal 100%</span>}
          </span>
        </div>
        {!probsValid && (
          <div className="mb-3 px-3 py-2 rounded border border-[#F85149]/40 bg-[#F85149]/5 text-xs font-mono text-[#F85149]">
            Probabilities do not sum to 100%. Adjust sliders until total = 100% for a valid expected value.
          </div>
        )}
        <div className="flex flex-col gap-3">
          {[
            ['bear', 'Bear', 'clr-red'],
            ['base', 'Base', 'clr-text'],
            ['bull', 'Bull', 'clr-success'],
          ].map(([key, label, className]) => (
            <label key={key} className={`scenario-prob-row ${activeSlider === key ? 'scenario-prob-row-active' : ''}`}>
              <span className={`scenario-prob-label ${className}`}>{label}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(probabilities[key as keyof typeof probabilities] * 100)}
                onChange={event => {
                  setActiveSlider(key)
                  onOverride(`scenarios.probabilities.${key}`, Number(event.target.value) / 100)
                }}
                onMouseUp={() => setActiveSlider(null)}
                onTouchEnd={() => setActiveSlider(null)}
                onBlur={() => setActiveSlider(null)}
                className="scenario-prob-slider"
                aria-label={`${label} scenario probability`}
              />
              <span className="scenario-prob-value">{Math.round(probabilities[key as keyof typeof probabilities] * 100)}%</span>
            </label>
          ))}
        </div>
      </div>

      {/* Assumption Drivers — color-coded rows */}
      <div className="p-4 card">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Scenario Assumption Drivers
        </h4>
        {scenarios ? (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="row-b">
                <th className="text-left py-2 clr-muted scenario-assumption-col">Assumption</th>
                <th className="py-2 clr-red">Bear</th>
                <th className="py-2 clr-text">Base</th>
                <th className="py-2 clr-success">Bull</th>
              </tr>
            </thead>
            <tbody>
              {DRIVER_CONFIG.map(({ key, label, format }) => (
                <tr key={key} className="row-b">
                  <td className="py-1.5 clr-muted">{label}</td>
                  {/* Bear cell — red tint */}
                  <td className="py-0 bg-[#F8514908]">
                    <AssumptionField label="" assumption={scenarios[key].bear} format={format} onOverride={v => onOverride(`scenarios.${key}.bear`, v)} />
                  </td>
                  {/* Base cell — neutral */}
                  <td className="py-0">
                    <AssumptionField label="" assumption={scenarios[key].base} format={format} onOverride={v => onOverride(`scenarios.${key}.base`, v)} />
                  </td>
                  {/* Bull cell — green tint */}
                  <td className="py-0 bg-[#3FB95008]">
                    <AssumptionField label="" assumption={scenarios[key].bull} format={format} onOverride={v => onOverride(`scenarios.${key}.bull`, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs clr-muted">No scenario assumptions available</p>
        )}
      </div>

      {/* Implied Prices per Scenario */}
      <div className="p-4 card">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Implied Prices by Scenario
        </h4>
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="row-b">
              <th className="text-left py-2 text-xs clr-muted">Method</th>
              <th className="text-right py-2 text-xs clr-red">Bear</th>
              <th className="text-right py-2 text-xs clr-text">Base</th>
              <th className="text-right py-2 text-xs clr-success">Bull</th>
            </tr>
          </thead>
          <tbody>
            {['DCF', 'DDM', 'Comps'].map(method => {
              const key = method.toLowerCase() as 'dcf' | 'ddm' | 'comps'
              const priceKey = `${key}Price` as 'dcfPrice' | 'ddmPrice' | 'compsPrice'
              return (
                <tr key={method} className="row-b">
                  <td className="py-1.5 clr-text">{method}</td>
                  <td className={`text-right py-1.5 ${scenarioClasses.bear}`}>
                    {formatCurrency(scenarioOutput.bear[priceKey])}
                  </td>
                  <td className={`text-right py-1.5 ${scenarioClasses.base}`}>
                    {formatCurrency(scenarioOutput.base[priceKey])}
                  </td>
                  <td className={`text-right py-1.5 ${scenarioClasses.bull}`}>
                    {formatCurrency(scenarioOutput.bull[priceKey])}
                  </td>
                </tr>
              )
            })}
            <tr className="row-t-2">
              <td className="py-2 font-semibold clr-text">Weighted</td>
              <td className={`text-right py-2 font-bold ${scenarioClasses.bear}`}>
                {formatCurrency(scenarioOutput.bear.weightedPrice)}
              </td>
              <td className={`text-right py-2 font-bold ${scenarioClasses.base}`}>
                {formatCurrency(scenarioOutput.base.weightedPrice)}
              </td>
              <td className={`text-right py-2 font-bold ${scenarioClasses.bull}`}>
                {formatCurrency(scenarioOutput.bull.weightedPrice)}
              </td>
            </tr>
            <tr>
              <td className="py-2 font-semibold clr-amber">Expected Value</td>
              <td className="text-right py-2 clr-muted">{Math.round(scenarioOutput.probabilityWeights.bear * 100)}%</td>
              <td className="text-right py-2 font-bold clr-amber">{formatCurrency(scenarioOutput.expectedPrice)}</td>
              <td className="text-right py-2 clr-muted">{Math.round(scenarioOutput.probabilityWeights.bull * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
