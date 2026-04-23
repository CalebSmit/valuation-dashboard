/**
 * Shared Price Target panel — renders on Overview, DCF, DDM, and Comps tabs.
 * Shows the blended price target, model weights (top), and sub-weight sliders
 * for DCF, Comps, and DDM.
 */
import { useState } from 'react'
import type { DCFSubWeights, CompsSubWeights, DDMSubWeights, ModelWeights, AIRecommendedConfig } from '../types/ValuationConfig.ts'
import type { BlendedPriceTarget } from '../types/BlendedOutput.ts'
import { WeightSlider } from './WeightSlider.tsx'
import { formatCurrency } from '../utils/formatters.ts'

interface ValuationConfigPanelProps {
  dcfSubWeights: DCFSubWeights
  compsSubWeights: CompsSubWeights
  ddmSubWeights: DDMSubWeights
  modelWeights: ModelWeights
  blendedOutput: BlendedPriceTarget | null
  currentPrice: number | null
  aiRecommended: AIRecommendedConfig | null
  isAIDefault: boolean
  ddmApplicable: boolean
  onDCFSubWeightChange: (key: keyof DCFSubWeights, value: number) => void
  onCompsSubWeightChange: (key: keyof CompsSubWeights, value: number) => void
  onDDMSubWeightChange: (key: keyof DDMSubWeights, value: number) => void
  onModelWeightChange: (key: keyof ModelWeights, value: number) => void
  onResetToAI: () => void
}

export function ValuationConfigPanel({
  dcfSubWeights,
  compsSubWeights,
  ddmSubWeights,
  modelWeights,
  blendedOutput,
  currentPrice,
  aiRecommended,
  isAIDefault,
  ddmApplicable,
  onDCFSubWeightChange,
  onCompsSubWeightChange,
  onDDMSubWeightChange,
  onModelWeightChange,
  onResetToAI,
}: ValuationConfigPanelProps) {
  const [expanded, setExpanded] = useState(false)

  const finalPrice = blendedOutput?.finalPrice ?? null
  const upside = finalPrice !== null && currentPrice !== null && currentPrice > 0
    ? (finalPrice - currentPrice) / currentPrice
    : null

  const recommendation = upside === null
    ? 'HOLD'
    : upside >= 0.2
      ? 'STRONG BUY'
      : upside >= 0.1
        ? 'BUY'
        : upside > -0.05
          ? 'HOLD'
          : upside > -0.15
            ? 'SELL'
            : 'STRONG SELL'

  const recommendationClass = recommendation === 'STRONG BUY'
    ? 'recommendation-strong-buy'
    : recommendation === 'BUY'
      ? 'recommendation-buy'
      : recommendation === 'HOLD'
        ? 'recommendation-hold'
        : recommendation === 'SELL'
          ? 'recommendation-sell'
          : 'recommendation-strong-sell'

  return (
    <div className="card overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full px-4 py-3 text-left hover:bg-[#21262D] transition-colors"
      >
        <div className="valuation-header-shell">
          <div className={`recommendation-bar ${recommendationClass}`}>
            {recommendation}
          </div>
          <div className="valuation-header-metrics valuation-header-metrics-centered mt-1">
            <div className="valuation-header-metric valuation-header-metric-centered">
              <span className="valuation-header-label">Blended Fair Value</span>
              <span className="valuation-header-value clr-accent">
                {formatCurrency(finalPrice)}
              </span>
            </div>
            <div className="valuation-header-metric valuation-header-metric-centered">
              <span className="valuation-header-label">Current</span>
              <span className="valuation-header-value clr-text">
                {formatCurrency(currentPrice)}
              </span>
            </div>
            <div className="valuation-header-metric valuation-header-metric-centered">
              <span className="valuation-header-label">Implied Return</span>
              <span className={`valuation-header-value ${upside !== null && upside < 0 ? 'clr-red' : 'clr-success'}`}>
                {upside !== null ? `${upside > 0 ? '+' : ''}${(upside * 100).toFixed(1)}%` : 'N/A'}
              </span>
            </div>
          </div>
          <div className="valuation-header-bottom-row">
            <span className="valuation-header-bottom-spacer" aria-hidden="true" />
            <p className="valuation-header-helper">
              Click dropdown to change model weightings.
            </p>
            <div className="flex items-center gap-2 valuation-header-controls">
              {!isAIDefault && aiRecommended && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onResetToAI() }}
                  className="px-2 py-1 text-[10px] font-mono border rounded clr-muted hover:clr-accent hover:border-[#00FF88] transition-colors"
                  title="Reset to AI recommendation"
                >
                  Reset to AI
                </button>
              )}
              <span className="text-xs clr-muted">{expanded ? '\u25B2' : '\u25BC'}</span>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[#30363D]">
          {/* Model Weights (top) */}
          <div className="mb-4">
            <h5 className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-2">
              Model Weights
            </h5>
            <div className="flex flex-col gap-2">
              <WeightSlider
                label="DCF"
                value={modelWeights.dcf}
                onChange={v => onModelWeightChange('dcf', v)}
                color="#00FF88"
              />
              <WeightSlider
                label="Comps"
                value={modelWeights.comps}
                onChange={v => onModelWeightChange('comps', v)}
                color="#F0A500"
              />
              <WeightSlider
                label="DDM"
                value={modelWeights.ddm}
                onChange={v => onModelWeightChange('ddm', v)}
                color="#4493F8"
                disabled={!ddmApplicable}
              />
            </div>
          </div>

          {/* Sub-Weights: DCF / Comps / DDM side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* DCF Sub-Weights */}
            <div>
              <h5 className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-2">
                DCF Sub-Weights
              </h5>
              <div className="flex flex-col gap-2">
                <WeightSlider
                  label="Blended"
                  value={dcfSubWeights.blended}
                  onChange={v => onDCFSubWeightChange('blended', v)}
                  color="#00FF88"
                />
                <WeightSlider
                  label="Exit"
                  value={dcfSubWeights.exitOnly}
                  onChange={v => onDCFSubWeightChange('exitOnly', v)}
                  color="#00CC6A"
                />
                <WeightSlider
                  label="Gordon"
                  value={dcfSubWeights.gordonOnly}
                  onChange={v => onDCFSubWeightChange('gordonOnly', v)}
                  color="#009950"
                />
              </div>
            </div>

            {/* Comps Sub-Weights */}
            <div>
              <h5 className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-2">
                Comps Sub-Weights
              </h5>
              <div className="flex flex-col gap-2">
                <WeightSlider
                  label="EV/EBITDA"
                  value={compsSubWeights.evEbitda}
                  onChange={v => onCompsSubWeightChange('evEbitda', v)}
                  color="#F0A500"
                />
                <WeightSlider
                  label="P/E"
                  value={compsSubWeights.pe}
                  onChange={v => onCompsSubWeightChange('pe', v)}
                  color="#D48E00"
                />
                <WeightSlider
                  label="EV/Sales"
                  value={compsSubWeights.evSales}
                  onChange={v => onCompsSubWeightChange('evSales', v)}
                  color="#B87800"
                />
                <WeightSlider
                  label="P/B"
                  value={compsSubWeights.pb}
                  onChange={v => onCompsSubWeightChange('pb', v)}
                  color="#9C6200"
                />
              </div>
            </div>

            {/* DDM Sub-Weights */}
            <div>
              <h5 className="text-[10px] uppercase tracking-wider font-mono clr-muted mb-2">
                DDM Sub-Weights
              </h5>
              <div className="flex flex-col gap-2">
                <WeightSlider
                  label="Two-Stage"
                  value={ddmSubWeights.twoStage}
                  onChange={v => onDDMSubWeightChange('twoStage', v)}
                  color="#4493F8"
                  disabled={!ddmApplicable}
                />
                <WeightSlider
                  label="Single"
                  value={ddmSubWeights.singleStage}
                  onChange={v => onDDMSubWeightChange('singleStage', v)}
                  color="#2A6FC4"
                  disabled={!ddmApplicable}
                />
              </div>
            </div>
          </div>

          {/* AI Rationale */}
          {aiRecommended?.rationale && (
            <div className="mt-4 pt-3 border-t border-[#30363D]">
              <span className="text-[10px] uppercase tracking-wider font-mono clr-muted">
                AI Rationale
              </span>
              <p className="text-xs font-sans clr-muted mt-1 leading-relaxed">
                {aiRecommended.rationale}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
