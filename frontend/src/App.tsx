import { useCallback, useEffect, useRef } from 'react'
import { useSettings } from './hooks/useSettings.ts'
import { useValuationRun } from './hooks/useValuationRun.ts'
import { useRunHistory } from './hooks/useRunHistory.ts'
import { useAssumptions } from './hooks/useAssumptions.ts'
import { useDataOverrides } from './hooks/useDataOverrides.ts'
import { useValuationConfig } from './hooks/useValuationConfig.ts'
import { useForecastOverrides } from './hooks/useForecastOverrides.ts'
import { useCritique } from './hooks/useCritique.ts'
import { computeBlendedPriceTarget } from './services/blendingEngine.ts'
import { TickerInput } from './components/TickerInput.tsx'
import { SettingsModal } from './components/SettingsModal.tsx'
import { AgentLogPanel } from './components/AgentLogPanel.tsx'
import { ValuationTabs } from './components/ValuationTabs.tsx'
import { ExportButton } from './components/ExportButton.tsx'
import { EmptyState } from './components/EmptyState.tsx'
import { ErrorState } from './components/ErrorState.tsx'
import { OnboardingGuide } from './components/OnboardingGuide.tsx'
import { exportToExcel } from './services/excelExporter.ts'
import { exportToPDF } from './services/pdfExporter.ts'

function App() {
  const { provider, apiKey, fredApiKey, providerConfiguredOnServer, isSettingsOpen, setProvider, setApiKey, setFredApiKey, openSettings, closeSettings } = useSettings()
  const { run, startRun, loadRun, recalculate, resetRun } = useValuationRun()
  const { runs: recentRuns, deleteRun, refresh: refreshHistory } = useRunHistory()
  const { mergedAssumptions, applyOverride, clearOverrides, overrides } = useAssumptions(run?.assumptions ?? null)
  const { mergedData, applyDataOverride, clearDataOverrides, overrides: dataOverrides } = useDataOverrides(run?.financialData ?? null)
  const { config: valuationConfig, isAIDefault, updateDCFConfig, updateDCFSubWeight, updateCompsSubWeight, updateDDMSubWeight, updateModelWeight, resetToAI } = useValuationConfig(run?.aiRecommendedConfig ?? null)
  const { forecastOutput, applyForecastOverride, clearForecastOverrides } = useForecastOverrides(run?.forecastPresets ?? null, run?.forecastBaseYear ?? null, mergedAssumptions?.forecast ?? null)
  const { report: critiqueReport, isRunning: isCritiqueRunning, isRefining, refineError, refineChanges, refine, dismissRefineChanges } = useCritique(run ?? null)
  const blendedOutput = run?.dcfOutput
    ? computeBlendedPriceTarget(run.dcfOutput, run.ddmOutput, run.compsOutput, valuationConfig)
    : null

  const handleAnalyze = useCallback(async (ticker: string, deepResearch: boolean = false) => {
    if (!apiKey && !providerConfiguredOnServer) {
      openSettings()
      return
    }
    await startRun(ticker, apiKey ?? '', provider, deepResearch, fredApiKey ?? undefined)
    refreshHistory()
  }, [apiKey, fredApiKey, provider, providerConfiguredOnServer, startRun, openSettings, refreshHistory])

  const handleLoadRun = useCallback(async (id: string) => {
    await loadRun(id)
    clearOverrides()
    clearDataOverrides()
    clearForecastOverrides()
  }, [loadRun, clearOverrides, clearDataOverrides, clearForecastOverrides])

  // Auto-recalculate when user overrides change (not when recalculate updates run.assumptions).
  // overrideKey serializes user-controlled state only (override objects + config).
  // recalculate() updates run.assumptions but NOT the override objects, so overrideKey stays stable.
  const forecastRevenues = forecastOutput?.revenues ?? null
  const overrideKey = JSON.stringify(overrides) + JSON.stringify(dataOverrides) + JSON.stringify(valuationConfig) + JSON.stringify(forecastRevenues)
  const settledKey = useRef<string | null>(null)

  // Snapshot the overrideKey once the run first reaches 'complete' (all initial config settled).
  // Any subsequent change to overrideKey indicates a user edit.
  useEffect(() => {
    if (run?.status !== 'complete') {
      settledKey.current = null // reset for next run
    }
  }, [run?.status])

  useEffect(() => {
    if (!run || run.status !== 'complete' || !mergedAssumptions || !mergedData) return

    if (settledKey.current === null) {
      // First time seeing 'complete' with this overrideKey — snapshot it, skip recalc
      settledKey.current = overrideKey
      return
    }

    if (overrideKey === settledKey.current) return // no change since settled

    settledKey.current = overrideKey
    recalculate(mergedAssumptions, mergedData, valuationConfig, forecastRevenues ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on overrideKey only
  }, [overrideKey])

  const handleNewRun = useCallback(() => {
    resetRun()
    clearOverrides()
    clearDataOverrides()
  }, [resetRun, clearOverrides, clearDataOverrides])

  const handleRefine = useCallback(() => {
    if (!mergedAssumptions || !mergedData) return
    refine(apiKey ?? '', provider, (revised) => {
      recalculate(revised, mergedData, valuationConfig)
    })
  }, [refine, apiKey, provider, recalculate, mergedAssumptions, mergedData, valuationConfig])

  const isRunning = run?.status === 'pipeline' || run?.status === 'fetching' || run?.status === 'researching' || run?.status === 'calculating'
  const showDashboard = run && run.status !== 'idle'
  const showOnboarding = !showDashboard && !apiKey && recentRuns.length === 0

  return (
    <div className="flex min-h-screen app-root">
      {/* Settings Modal (includes History tab) */}
      {isSettingsOpen && (
        <SettingsModal
          currentProvider={provider}
          providerConfiguredOnServer={providerConfiguredOnServer}
          currentFredKey={fredApiKey}
          onProviderChange={setProvider}
          onSave={setApiKey}
          onSaveFredKey={setFredApiKey}
          onClose={closeSettings}
          canClose={!!apiKey || providerConfiguredOnServer}
          recentRuns={recentRuns}
          activeRunId={run?.id ?? null}
          onLoadRun={handleLoadRun}
          onDeleteRun={deleteRun}
        />
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Auto-recalculation is active — no manual button needed */}

        {/* Idle state — ticker input */}
        {!showDashboard && showOnboarding && (
          <OnboardingGuide hasApiKey={!!apiKey} onOpenSettings={openSettings} />
        )}

        {!showDashboard && !showOnboarding && (
          <>
            <TickerInput
              onAnalyze={handleAnalyze}
              onLoadRun={handleLoadRun}
              recentRuns={recentRuns}
              disabled={false}
            />
            {recentRuns.length === 0 && <EmptyState />}
          </>
        )}

        {/* Dashboard state */}
        {showDashboard && (
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-3 scanline-header dashboard-header">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleNewRun}
                  className="text-xs uppercase tracking-wider px-3 py-1.5 btn-new"
                >
                  New
                </button>
                <div>
                  <h1 className="text-xl font-bold ticker-title">
                    {run.ticker}
                    {run.cached && (
                      <span
                        title="Served from same-day server cache"
                        className="ml-2 inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-600/40 text-slate-200 align-middle"
                      >
                        Cached
                      </span>
                    )}
                    <span className="ml-2 font-normal text-sm ticker-company">
                      {run.companyName}
                    </span>
                  </h1>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 run-status-badge ${run.status === 'complete' ? 'status-complete' : run.status === 'error' ? 'status-error' : 'status-running'}`}
                >
                  {run.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openSettings}
                  className="text-xs btn-settings"
                >
                  Settings
                </button>
                <ExportButton
                  disabled={run.status !== 'complete'}
                  onExportExcel={() => { if (run.status === 'complete') exportToExcel(run) }}
                  onExportPDF={async () => { if (run.status === 'complete') await exportToPDF(run) }}
                />
              </div>
            </div>

            {/* Error state */}
            {run.status === 'error' && run.error && (
              <div className="p-6">
                <ErrorState error={run.error} onRetry={handleNewRun} />
              </div>
            )}

            {/* Main dashboard area */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Tabs area */}
              <div className="flex-1 overflow-y-auto">
                {(run.status === 'complete' || run.status === 'calculating') && (
                  <ValuationTabs
                    run={run}
                    mergedAssumptions={mergedAssumptions}
                    mergedData={mergedData}
                    originalData={run.financialData}
                    onOverride={applyOverride}
                    onDataOverride={applyDataOverride}
                    onForecastOverride={applyForecastOverride}
                    dcfConfig={valuationConfig.dcfConfig}
                    dcfSubWeights={valuationConfig.dcfSubWeights}
                    compsSubWeights={valuationConfig.compsSubWeights}
                    ddmSubWeights={valuationConfig.ddmSubWeights}
                    modelWeights={valuationConfig.modelWeights}
                    blendedOutput={blendedOutput}
                    aiRecommended={run.aiRecommendedConfig ?? null}
                    isAIDefault={isAIDefault}
                    onDCFConfigChange={updateDCFConfig}
                    onDCFSubWeightChange={updateDCFSubWeight}
                    onCompsSubWeightChange={updateCompsSubWeight}
                    onDDMSubWeightChange={updateDDMSubWeight}
                    onModelWeightChange={updateModelWeight}
                    onResetToAI={resetToAI}
                    liveForecastOutput={forecastOutput}
                    critiqueReport={critiqueReport}
                    isCritiqueRunning={isCritiqueRunning}
                    isRefining={isRefining}
                    refineError={refineError}
                    refineChanges={refineChanges}
                    hasApiKey={!!(apiKey || providerConfiguredOnServer)}
                    onRefine={handleRefine}
                    onDismissRefineChanges={dismissRefineChanges}
                  />
                )}
                {isRunning && !run.dcfOutput && (
                  <div className="flex items-center justify-center loading-centered">
                    <div className="text-center space-y-4">
                      <div className="flex justify-center gap-1.5">
                        <span className="loading-dot loading-dot-1" />
                        <span className="loading-dot loading-dot-2" />
                        <span className="loading-dot loading-dot-3" />
                      </div>
                      <p className="text-base font-mono clr-amber">
                        {run.status === 'pipeline' ? 'Running data pipeline...' :
                         run.status === 'fetching' ? 'Loading financial data...' :
                         run.status === 'researching' ? 'AI agent analyzing...' :
                         'Computing valuations...'}
                      </p>
                      <p className="text-xs font-mono clr-muted">
                        {run.status === 'pipeline' ? 'Fetching financial statements from APIs' :
                         run.status === 'fetching' ? 'Parsing raw_data.xlsx' :
                         run.status === 'researching' ? 'This may take 30-90 seconds' :
                         'Running DCF, DDM, and comps engines'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Agent log panel — collapsible, below tabs */}
              <AgentLogPanel
                entries={run.agentLog}
                isActive={isRunning || (run.status === 'complete' && run.agentLog.length > 0)}
                cached={run.cached}
                usage={run.usage}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
