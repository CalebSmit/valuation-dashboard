import type { FinancialData } from './FinancialData.ts'
import type { Assumptions } from './Assumptions.ts'
import type { DCFOutput } from './DCFOutput.ts'
import type { DDMOutput } from './DDMOutput.ts'
import type { CompsOutput } from './CompsOutput.ts'
import type { ScenarioOutput } from './ScenarioOutput.ts'
import type { ValuationConfig, AIRecommendedConfig } from './ValuationConfig.ts'
import type { BlendedPriceTarget } from './BlendedOutput.ts'
import type { ForecastOutput, PresetAssumptions, BaseYearData } from './ForecastOutput.ts'

export type RunStatus = 'idle' | 'pipeline' | 'fetching' | 'researching' | 'calculating' | 'complete' | 'error'

export interface AgentLogEntry {
  status: 'running' | 'done' | 'error'
  text: string
  timestamp: number
}

export interface ValuationRun {
  id: string
  ticker: string
  companyName: string
  currentPrice: number | null
  createdAt: number
  status: RunStatus

  financialData: FinancialData | null
  assumptions: Assumptions | null
  overrideAssumptions: Record<string, number>

  dcfOutput: DCFOutput | null
  ddmOutput: DDMOutput | null
  compsOutput: CompsOutput | null
  scenarioOutput: ScenarioOutput | null
  previousPrices: {
    dcf: number | null
    ddm: number | null
    comps: number | null
  } | null

  valuationConfig: ValuationConfig | null
  aiRecommendedConfig: AIRecommendedConfig | null
  blendedOutput: BlendedPriceTarget | null

  forecastOutput: ForecastOutput | null
  forecastPresets: PresetAssumptions | null
  forecastBaseYear: BaseYearData | null

  agentLog: AgentLogEntry[]
  error: string | null

  /** Per-field auto-correction messages from the assumption validator (path → message). */
  fieldCorrections?: Record<string, string>

  /** True if the analysis was served from the same-day server-side cache. */
  cached?: boolean
  /** Anthropic usage tokens for the live run (zero for cache hits). */
  usage?: { input_tokens: number; output_tokens: number } | null
}
