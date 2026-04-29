import { useState, lazy, Suspense, type KeyboardEvent } from 'react'
import type { ValuationRun } from '../types/ValuationRun.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { FinancialData } from '../types/FinancialData.ts'
import type { DataOverrides } from '../hooks/useDataOverrides.ts'
import type { DCFConfig, DCFSubWeights, CompsSubWeights, DDMSubWeights, ModelWeights, AIRecommendedConfig } from '../types/ValuationConfig.ts'
import type { BlendedPriceTarget } from '../types/BlendedOutput.ts'
import type { ForecastOutput } from '../types/ForecastOutput.ts'
import type { CritiqueReport, CritiqueGrade } from '../types/CritiqueResult.ts'
import { ValuationConfigPanel } from './ValuationConfigPanel.tsx'
import { OverviewTab } from './OverviewTab.tsx'

// Heavy tabs loaded on demand to keep initial bundle small
const DCFTab = lazy(() => import('./DCFTab.tsx').then(m => ({ default: m.DCFTab })))
const DDMTab = lazy(() => import('./DDMTab.tsx').then(m => ({ default: m.DDMTab })))
const CompsTab = lazy(() => import('./CompsTab.tsx').then(m => ({ default: m.CompsTab })))
const ScenariosTab = lazy(() => import('./ScenariosTab.tsx').then(m => ({ default: m.ScenariosTab })))
const CompetitiveTab = lazy(() => import('./CompetitiveTab.tsx').then(m => ({ default: m.CompetitiveTab })))
const ForecastsTab = lazy(() => import('./ForecastsTab.tsx').then(m => ({ default: m.ForecastsTab })))
const CritiquePanel = lazy(() => import('./CritiquePanel.tsx').then(m => ({ default: m.CritiquePanel })))

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex gap-1.5">
        <span className="loading-dot loading-dot-1" />
        <span className="loading-dot loading-dot-2" />
        <span className="loading-dot loading-dot-3" />
      </div>
    </div>
  )
}
const TABS = ['Overview', 'Competitive', 'Forecasts', 'DCF', 'Comps', 'DDM', 'Scenarios', 'CFA Review'] as const
type TabName = typeof TABS[number]

const TABS_WITH_PRICE_PANEL: readonly TabName[] = ['Overview', 'DCF', 'DDM', 'Comps']

const TAB_TAKEAWAYS: Record<TabName, { title: string; takeaway: string; bridge: string }> = {
  Overview: {
    title: 'Executive Snapshot',
    takeaway: 'Know the call in under five seconds: blended target vs current price and where conviction comes from.',
    bridge: 'Then validate whether the company quality supports this call in Competitive.',
  },
  Competitive: {
    title: 'Quality Positioning',
    takeaway: 'See if the subject is fundamentally stronger, weaker, or merely expensive relative to peers.',
    bridge: 'Use that context before touching assumptions in Forecasts.',
  },
  Forecasts: {
    title: 'Engine Inputs',
    takeaway: 'This is the model engine room; every valuation output downstream is only as good as these assumptions.',
    bridge: 'Translate assumptions into intrinsic value in DCF.',
  },
  DCF: {
    title: 'Intrinsic Value Core',
    takeaway: 'Focus on blended DCF implied price and what drives it: growth, margins, reinvestment, and discount rate.',
    bridge: 'Cross-check reasonableness against market-based pricing in Comps.',
  },
  Comps: {
    title: 'Market Reality Check',
    takeaway: 'Understand where peer-implied value converges or diverges from intrinsic valuation.',
    bridge: 'Assess whether dividend assumptions justify inclusion via DDM.',
  },
  DDM: {
    title: 'Dividend Fit Test',
    takeaway: 'First question: is DDM even applicable? Only then treat the output as investable evidence.',
    bridge: 'Stress-test the full thesis under bear/base/bull conditions in Scenarios.',
  },
  Scenarios: {
    title: 'Risk-Weighted Range',
    takeaway: 'Judge distribution, not point estimate. Expected value matters only if probabilities are credible.',
    bridge: 'Finish with CFA defensibility and presentation readiness checks.',
  },
  'CFA Review': {
    title: 'Investment Committee Readiness',
    takeaway: 'Final impression: grade quality, remove critical issues, and lock a defensible recommendation.',
    bridge: 'This is the final checkpoint before export and presentation.',
  },
}

interface ValuationTabsProps {
  run: ValuationRun
  mergedAssumptions: Assumptions | null
  mergedData: FinancialData | null
  originalData: FinancialData | null
  onOverride: (path: string, value: number) => void
  onDataOverride: (field: keyof DataOverrides, value: number) => void
  onForecastOverride: (key: string, value: number) => void
  dcfConfig: DCFConfig
  dcfSubWeights: DCFSubWeights
  compsSubWeights: CompsSubWeights
  ddmSubWeights: DDMSubWeights
  modelWeights: ModelWeights
  blendedOutput: BlendedPriceTarget | null
  aiRecommended: AIRecommendedConfig | null
  isAIDefault: boolean
  onDCFConfigChange: (partial: Partial<DCFConfig>) => void
  onDCFSubWeightChange: (key: keyof DCFSubWeights, value: number) => void
  onCompsSubWeightChange: (key: keyof CompsSubWeights, value: number) => void
  onDDMSubWeightChange: (key: keyof DDMSubWeights, value: number) => void
  onModelWeightChange: (key: keyof ModelWeights, value: number) => void
  onResetToAI: () => void
  liveForecastOutput: ForecastOutput | null
  critiqueReport: CritiqueReport | null
  isCritiqueRunning: boolean
  isRefining: boolean
  refineError: string | null
  refineChanges: string[]
  hasApiKey: boolean
  onRefine: () => void
  onDismissRefineChanges: () => void
}


const GRADE_TAB_COLOR: Record<CritiqueGrade, string> = {
  A: 'text-[#3FB950]',
  B: 'text-[#58A6FF]',
  C: 'text-[#F0A500]',
  D: 'text-[#F85149]',
  F: 'text-[#F85149]',
}

export function ValuationTabs({
  run, mergedAssumptions, mergedData, originalData, onOverride, onDataOverride, onForecastOverride,
  dcfConfig, dcfSubWeights, compsSubWeights, ddmSubWeights, modelWeights,
  blendedOutput, aiRecommended, isAIDefault,
  onDCFConfigChange, onDCFSubWeightChange, onCompsSubWeightChange, onDDMSubWeightChange,
  onModelWeightChange, onResetToAI, liveForecastOutput,
  critiqueReport, isCritiqueRunning, isRefining, refineError, refineChanges,
  hasApiKey, onRefine, onDismissRefineChanges,
}: ValuationTabsProps) {
  const [activeTab, setActiveTab] = useState<TabName>('Overview')

  const ddmApplicable = run.ddmOutput?.isApplicable ?? false
  const activeMeta = TAB_TAKEAWAYS[activeTab]

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' && index < TABS.length - 1) {
      event.preventDefault()
      setActiveTab(TABS[index + 1])
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      setActiveTab(TABS[index - 1])
    }
  }

  return (
    <div className="flex-1">
      {/* Tab bar — horizontally scrollable on mobile */}
      <div className="flex gap-0 row-b overflow-x-auto scrollbar-hide" aria-label="Valuation workflow tabs" style={{ WebkitOverflowScrolling: 'touch' }}>
        {TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            onKeyDown={event => handleTabKeyDown(event, index)}
            className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'tab-btn-active' : 'tab-btn'}`}
            aria-label={`${tab} tab`}
          >
            {tab === 'CFA Review' && critiqueReport ? (
              <span className="flex items-center gap-1.5">
                CFA Review
                <span className={`font-mono font-bold ${GRADE_TAB_COLOR[critiqueReport.overall_grade]}`}>
                  {critiqueReport.overall_grade}
                </span>
              </span>
            ) : tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        <div className="card p-4 mb-4 tab-takeaway">
          <div className="tab-takeaway-eyebrow">{activeMeta.title}</div>
          <p className="tab-takeaway-main">{activeMeta.takeaway}</p>
          <p className="tab-takeaway-bridge">{activeMeta.bridge}</p>
        </div>

        {/* Shared Price Target panel — visible on Overview, DCF, DDM, Comps */}
        {TABS_WITH_PRICE_PANEL.includes(activeTab) && (
          <div className="mb-4">
            <ValuationConfigPanel
              dcfSubWeights={dcfSubWeights}
              compsSubWeights={compsSubWeights}
              ddmSubWeights={ddmSubWeights}
              modelWeights={modelWeights}
              blendedOutput={blendedOutput}
              currentPrice={run.currentPrice}
              aiRecommended={aiRecommended}
              isAIDefault={isAIDefault}
              ddmApplicable={ddmApplicable}
              onDCFSubWeightChange={onDCFSubWeightChange}
              onCompsSubWeightChange={onCompsSubWeightChange}
              onDDMSubWeightChange={onDDMSubWeightChange}
              onModelWeightChange={onModelWeightChange}
              onResetToAI={onResetToAI}
            />
          </div>
        )}

        <Suspense fallback={<TabFallback />}>
          {activeTab === 'Overview' && (
            <OverviewTab
              run={run}
              blendedOutput={blendedOutput}
            />
          )}
          {activeTab === 'Forecasts' && (
            <ForecastsTab
              forecastOutput={liveForecastOutput ?? run.forecastOutput}
              presets={run.forecastPresets}
              baseYear={run.forecastBaseYear}
              aiForecasts={mergedAssumptions?.forecast ?? null}
              onPresetOverride={onForecastOverride}
            />
          )}
          {activeTab === 'DCF' && mergedAssumptions && (
            <DCFTab
              dcfOutput={run.dcfOutput}
              assumptions={mergedAssumptions}
              financialData={mergedData}
              originalData={originalData}
              previousPrice={run.previousPrices?.dcf ?? null}
              currentPrice={run.currentPrice ?? null}
              onOverride={onOverride}
              onDataOverride={onDataOverride}
              dcfConfig={dcfConfig}
              onDCFConfigChange={onDCFConfigChange}
              fieldCorrections={run.fieldCorrections}
            />
          )}
          {activeTab === 'DDM' && (
            <DDMTab
              ddmOutput={run.ddmOutput}
              assumptions={mergedAssumptions}
              currentDPS={mergedData?.annualDividendRate ?? null}
              originalDPS={originalData?.annualDividendRate ?? null}
              currentPrice={run.currentPrice ?? null}
              dividendMetrics={mergedData?.dividendMetricsDetail}
              onOverride={onOverride}
              onDataOverride={onDataOverride}
            />
          )}
          {activeTab === 'Comps' && (
            <CompsTab compsOutput={run.compsOutput} currentPrice={run.currentPrice ?? null} />
          )}
          {activeTab === 'Scenarios' && (
            <ScenariosTab
              scenarioOutput={run.scenarioOutput}
              assumptions={mergedAssumptions}
              onOverride={onOverride}
            />
          )}
          {activeTab === 'Competitive' && (
            <CompetitiveTab financialData={mergedData} />
          )}
          {activeTab === 'CFA Review' && (
            <CritiquePanel
              report={critiqueReport}
              isRunning={isCritiqueRunning}
              isRefining={isRefining}
              refineError={refineError}
              refineChanges={refineChanges}
              hasApiKey={hasApiKey}
              onRefine={onRefine}
              onDismissChanges={onDismissRefineChanges}
            />
          )}
        </Suspense>
      </div>
    </div>
  )
}
