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
  const spread = scenarioOutput.bull.weightedPrice !== null && scenarioOutput.bear.weightedPrice !== null
    ? scenarioOutput.bull.weightedPrice - scenarioOutput.bear.weightedPrice
    : null

  return (
    <div className="flex flex-col gap-5">
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
            <div className="scenario-glance-label">Probabilities</div>
            <div className={`scenario-glance-main ${Math.abs(probabilityTotal - 1) <= 0.01 ? 'clr-success' : 'clr-amber'}`}>
              {(probabilityTotal * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 card">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
            Scenario Probabilities
          </h4>
          <span className={`text-xs font-mono ${Math.abs(probabilityTotal - 1) <= 0.01 ? 'clr-success' : 'clr-amber'}`}>
            Total: {(probabilityTotal * 100).toFixed(0)}%
          </span>
        </div>
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

      {/* Assumption Drivers — editable */}
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
                  <td className="py-0"><AssumptionField label="" assumption={scenarios[key].bear} format={format} onOverride={v => onOverride(`scenarios.${key}.bear`, v)} /></td>
                  <td className="py-0"><AssumptionField label="" assumption={scenarios[key].base} format={format} onOverride={v => onOverride(`scenarios.${key}.base`, v)} /></td>
                  <td className="py-0"><AssumptionField label="" assumption={scenarios[key].bull} format={format} onOverride={v => onOverride(`scenarios.${key}.bull`, v)} /></td>
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
