/**
 * Main orchestration hook — manages the full valuation run lifecycle.
 * Fetches data, runs AI agent, computes valuations, saves to IndexedDB.
 */
import { useState, useCallback } from 'react'
import type { ValuationRun, AgentLogEntry, RunStatus } from '../types/ValuationRun.ts'
import type { FinancialData } from '../types/FinancialData.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { ValuationConfig } from '../types/ValuationConfig.ts'
import { DEFAULT_VALUATION_CONFIG } from '../types/ValuationConfig.ts'
import { fetchFinancialSummary, runPipeline, fetchPeerData } from '../services/financialFetcher.ts'
import { fetchForecastPresets } from '../services/forecastFetcher.ts'
import { runAgent } from '../services/agentRunner.ts'
import { computeForecast } from '../services/forecastEngine.ts'
import { computeDCF } from '../services/dcfEngine.ts'
import { computeDDM } from '../services/ddmEngine.ts'
import { computeComps } from '../services/compsEngine.ts'
import { buildScenarios } from '../services/scenarioEngine.ts'
import { computeBlendedPriceTarget } from '../services/blendingEngine.ts'
import { validateAssumptions } from '../services/assumptionValidator.ts'
import { saveRun, getRun, updateRun } from '../services/database.ts'

const SESSION_DATA_REUSE_MS = 20 * 60 * 1000

function createEmptyRun(ticker: string): ValuationRun {
  return {
    id: crypto.randomUUID(),
    ticker: ticker.toUpperCase(),
    companyName: '',
    currentPrice: null,
    createdAt: Date.now(),
    status: 'pipeline',
    financialData: null,
    assumptions: null,
    overrideAssumptions: {},
    dcfOutput: null,
    ddmOutput: null,
    compsOutput: null,
    scenarioOutput: null,
    previousPrices: null,
    valuationConfig: null,
    aiRecommendedConfig: null,
    blendedOutput: null,
    forecastOutput: null,
    forecastPresets: null,
    forecastBaseYear: null,
    agentLog: [],
    error: null,
    fieldCorrections: {},
  }
}

export function useValuationRun() {
  const [run, setRun] = useState<ValuationRun | null>(null)

  const addLogEntry = useCallback((entry: AgentLogEntry) => {
    setRun(prev => {
      if (!prev) return prev
      return { ...prev, agentLog: [...prev.agentLog, entry] }
    })
  }, [])

  const setStatus = useCallback((status: RunStatus) => {
    setRun(prev => {
      if (!prev) return prev
      return { ...prev, status }
    })
  }, [])

  const startRun = useCallback(async (ticker: string, apiKey: string, provider: string = 'anthropic', deepResearch: boolean = false, fredApiKey?: string) => {
    const newRun = createEmptyRun(ticker)
    setRun(newRun)

    try {
      const sameTickerRecentRun =
        run?.ticker.toUpperCase() === ticker.toUpperCase() &&
        run.status === 'complete' &&
        Date.now() - run.createdAt < SESSION_DATA_REUSE_MS

      let financialData: FinancialData
      let forecastPresets = null
      let forecastBaseYear = null

      if (sameTickerRecentRun) {
        addLogEntry({
          status: 'running',
          text: `Fast mode: skipping pipeline for recent ${ticker.toUpperCase()} run`,
          timestamp: Date.now(),
        })
      } else {
        // Step 0: Run the data pipeline (py main.py)
        addLogEntry({ status: 'running', text: `Running data pipeline for ${ticker}...`, timestamp: Date.now() })
        await runPipeline(ticker, addLogEntry, fredApiKey)
      }

      setStatus('fetching')

      // Step 1: Always fetch financial summary for freshness
      addLogEntry({ status: 'running', text: 'Loading financial summary from raw_data.xlsx...', timestamp: Date.now() })
      financialData = await fetchFinancialSummary()
      addLogEntry({ status: 'done', text: `Loaded data for ${financialData.companyName}`, timestamp: Date.now() })

      // Step 1b: Fetch forecast presets
      addLogEntry({ status: 'running', text: 'Loading forecast preset assumptions...', timestamp: Date.now() })
      try {
        const presetsResult = await fetchForecastPresets()
        forecastPresets = presetsResult.presets
        forecastBaseYear = presetsResult.baseYear
        addLogEntry({ status: 'done', text: 'Forecast presets loaded', timestamp: Date.now() })
      } catch {
        addLogEntry({ status: 'running', text: 'Forecast presets unavailable (will use AI only)', timestamp: Date.now() })
      }

      setRun(prev => prev ? {
        ...prev,
        financialData,
        companyName: financialData.companyName,
        currentPrice: financialData.currentPrice,
        forecastPresets,
        forecastBaseYear,
        status: 'researching',
      } : prev)

      // Step 2: Run AI agent
      const modeLabel = deepResearch ? 'Deep Research' : 'Standard'
      addLogEntry({ status: 'running', text: `AI agent generating assumptions (${modeLabel})...`, timestamp: Date.now() })
      const agentResult = await runAgent(ticker, apiKey, addLogEntry, provider, deepResearch)
      const assumptions: Assumptions = agentResult.assumptions
      const aiRecommendedConfig = agentResult.aiConfig
      const fieldCorrections = agentResult.fieldCorrections

      // Step 2b: Fetch peer data based on AI's selected peers
      const selectedPeers = assumptions.comps?.selected_peers ?? []
      let enrichedData = financialData
      if (selectedPeers.length > 0) {
        addLogEntry({ status: 'running', text: `Fetching data for peers: ${selectedPeers.join(', ')}...`, timestamp: Date.now() })
        const peerData = await fetchPeerData(selectedPeers)
        enrichedData = { ...financialData, competitors: peerData }
        addLogEntry({ status: 'done', text: `Loaded ${peerData.length} peer companies`, timestamp: Date.now() })
      }

      setRun(prev => prev ? { ...prev, assumptions, financialData: enrichedData, status: 'calculating' } : prev)

      // Step 3b: Compute forecast if presets available (before DCF so revenues are available)
      let forecastOutput = null
      if (forecastBaseYear && forecastPresets) {
        addLogEntry({ status: 'running', text: 'Building 3-statement forecast model...', timestamp: Date.now() })
        forecastOutput = computeForecast(forecastBaseYear, forecastPresets, assumptions.forecast ?? null, {})
        const balanceMsg = forecastOutput.validation.balanced ? 'balanced' : `${forecastOutput.validation.issues.length} issue(s)`
        addLogEntry({ status: 'done', text: `Forecast complete (BS: ${balanceMsg})`, timestamp: Date.now() })
      }

      // Step 3: Compute valuations
      addLogEntry({ status: 'running', text: 'Computing DCF valuation...', timestamp: Date.now() })
      const dcfOutput = computeDCF(enrichedData, assumptions, undefined, forecastOutput?.revenues)
      addLogEntry({ status: 'done', text: `DCF implied price: $${dcfOutput.impliedPrice?.toFixed(2) ?? 'N/A'}`, timestamp: Date.now() })

      addLogEntry({ status: 'running', text: 'Checking DDM applicability...', timestamp: Date.now() })
      const ddmOutput = computeDDM(enrichedData, assumptions.ddm, assumptions.wacc)
      addLogEntry({
        status: 'done',
        text: ddmOutput.isApplicable
          ? `DDM implied price: $${ddmOutput.impliedPrice?.toFixed(2) ?? 'N/A'}`
          : 'DDM not applicable — company does not pay dividends',
        timestamp: Date.now(),
      })

      addLogEntry({ status: 'running', text: 'Computing comparable company analysis...', timestamp: Date.now() })
      const compsOutput = computeComps(enrichedData, enrichedData.competitors, assumptions.comps)
      addLogEntry({ status: 'done', text: `Comps weighted price: $${compsOutput.weightedImpliedPrice?.toFixed(2) ?? 'N/A'}`, timestamp: Date.now() })

      addLogEntry({ status: 'running', text: 'Building Bear/Base/Bull scenarios...', timestamp: Date.now() })
      const scenarioOutput = buildScenarios(enrichedData, assumptions)
      addLogEntry({ status: 'done', text: 'Scenario analysis complete', timestamp: Date.now() })

      // Step 4: Compute blended price target using AI config if available
      const initialConfig: ValuationConfig = aiRecommendedConfig
        ? { ...DEFAULT_VALUATION_CONFIG, dcfConfig: aiRecommendedConfig.dcfConfig, dcfSubWeights: aiRecommendedConfig.dcfSubWeights, modelWeights: aiRecommendedConfig.modelWeights }
        : DEFAULT_VALUATION_CONFIG
      const blendedOutput = computeBlendedPriceTarget(dcfOutput, ddmOutput, compsOutput, initialConfig)

      // Step 5: Finalize run
      const completedRun: ValuationRun = {
        ...newRun,
        financialData: enrichedData,
        companyName: enrichedData.companyName,
        currentPrice: enrichedData.currentPrice,
        assumptions,
        dcfOutput,
        ddmOutput,
        compsOutput,
        scenarioOutput,
        previousPrices: null,
        valuationConfig: initialConfig,
        aiRecommendedConfig: aiRecommendedConfig ?? null,
        blendedOutput,
        forecastOutput,
        forecastPresets,
        forecastBaseYear,
        status: 'complete',
        agentLog: [], // Will be set by setRun
        fieldCorrections,
      }

      setRun(prev => ({
        ...completedRun,
        agentLog: [
          ...(prev?.agentLog ?? []),
          { status: 'done', text: 'Valuation complete', timestamp: Date.now() },
        ],
      }))

      // Save to IndexedDB
      await saveRun({
        ...completedRun,
        agentLog: [], // Don't persist full log
      })

    } catch (error) {
      console.error('[ValuationRun] startRun failed:', error)
      let errorMsg: string
      if (error instanceof Error) {
        errorMsg = error.message
        if (error.stack) console.error('[ValuationRun] Stack:', error.stack)
      } else if (typeof error === 'string') {
        errorMsg = error
      } else if (error && typeof error === 'object' && 'detail' in error) {
        errorMsg = String((error as Record<string, unknown>).detail)
      } else {
        try {
          errorMsg = `Unexpected error: ${JSON.stringify(error)}`
        } catch {
          errorMsg = `Unexpected error: ${String(error)}`
        }
      }
      addLogEntry({ status: 'error', text: errorMsg, timestamp: Date.now() })
      setRun(prev => prev ? { ...prev, status: 'error', error: errorMsg } : prev)
    }
  }, [addLogEntry, run, setStatus])

  const loadRun = useCallback(async (id: string) => {
    const saved = await getRun(id)
    if (saved) {
      setRun(saved)
    }
  }, [])

  const recalculate = useCallback((mergedAssumptions: Assumptions, mergedData?: FinancialData, valuationConfig?: ValuationConfig, forecastRevenues?: number[]) => {
    setRun(prev => {
      if (!prev) return prev
      const data = mergedData ?? prev.financialData
      if (!data) return prev
      const config = valuationConfig ?? prev.valuationConfig ?? DEFAULT_VALUATION_CONFIG
      const { corrected, fieldCorrections } = validateAssumptions(mergedAssumptions)
      const previousPrices = {
        dcf: prev.dcfOutput?.impliedPrice ?? null,
        ddm: prev.ddmOutput?.impliedPrice ?? null,
        comps: prev.compsOutput?.weightedImpliedPrice ?? null,
      }
      const dcfOutput = computeDCF(data, corrected, config.dcfConfig, forecastRevenues)
      const ddmOutput = computeDDM(data, corrected.ddm, corrected.wacc)
      const compsOutput = computeComps(data, data.competitors, corrected.comps)
      const scenarioOutput = buildScenarios(data, corrected, config)
      const blendedOutput = computeBlendedPriceTarget(dcfOutput, ddmOutput, compsOutput, config)

      const updated: ValuationRun = {
        ...prev,
        financialData: data,
        assumptions: corrected,
        dcfOutput,
        ddmOutput,
        compsOutput,
        scenarioOutput,
        previousPrices,
        valuationConfig: config,
        blendedOutput,
        fieldCorrections,
      }

      updateRun(prev.id, {
        assumptions: corrected,
        financialData: data,
        dcfOutput,
        ddmOutput,
        compsOutput,
        scenarioOutput,
        previousPrices,
        valuationConfig: config,
        blendedOutput,
      })

      return updated
    })
  }, [])

  const resetRun = useCallback(() => {
    setRun(null)
  }, [])

  return {
    run,
    startRun,
    loadRun,
    recalculate,
    resetRun,
  }
}
