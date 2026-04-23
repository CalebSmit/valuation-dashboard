/**
 * Runs the AI research agent via the backend SSE endpoint.
 * Streams progress steps to the UI and returns structured assumptions.
 */
import type { Assumptions } from '../types/Assumptions.ts'
import type { AgentLogEntry } from '../types/ValuationRun.ts'
import type { AIRecommendedConfig } from '../types/ValuationConfig.ts'
import {
  TerminalValueMethod,
  CashFlowBasis,
  DiscountingConvention,
  DEFAULT_DCF_CONFIG,
  DEFAULT_DCF_SUB_WEIGHTS,
  DEFAULT_MODEL_WEIGHTS,
} from '../types/ValuationConfig.ts'
import { validateAssumptions } from './assumptionValidator.ts'
import { API_BASE } from '../utils/constants.ts'

export function parseAIRecommendedConfig(raw: Record<string, unknown> | undefined): AIRecommendedConfig | null {
  if (!raw) return null

  const terminalMap: Record<string, TerminalValueMethod> = {
    blended: TerminalValueMethod.Blended,
    exit: TerminalValueMethod.ExitMultipleOnly,
    gordon: TerminalValueMethod.GordonGrowthOnly,
  }
  const basisMap: Record<string, CashFlowBasis> = {
    fcff: CashFlowBasis.FCFF,
    fcfe: CashFlowBasis.FCFE,
  }
  const discountMap: Record<string, DiscountingConvention> = {
    end: DiscountingConvention.EndOfPeriod,
    mid: DiscountingConvention.MidPeriod,
  }

  const tvMethod = raw.terminal_value_method as string | undefined
  const cfBasis = raw.cash_flow_basis as string | undefined
  const discConv = raw.discounting_convention as string | undefined
  const rawSubWeights = raw.dcf_sub_weights as Record<string, number> | undefined
  const rawModelWeights = raw.model_weights as Record<string, number> | undefined

  return {
    dcfConfig: {
      terminalValueMethod: terminalMap[tvMethod ?? ''] ?? DEFAULT_DCF_CONFIG.terminalValueMethod,
      cashFlowBasis: basisMap[cfBasis ?? ''] ?? DEFAULT_DCF_CONFIG.cashFlowBasis,
      discountingConvention: discountMap[discConv ?? ''] ?? DEFAULT_DCF_CONFIG.discountingConvention,
    },
    dcfSubWeights: {
      blended: rawSubWeights?.blended ?? DEFAULT_DCF_SUB_WEIGHTS.blended,
      exitOnly: rawSubWeights?.exit_only ?? DEFAULT_DCF_SUB_WEIGHTS.exitOnly,
      gordonOnly: rawSubWeights?.gordon_only ?? DEFAULT_DCF_SUB_WEIGHTS.gordonOnly,
    },
    modelWeights: {
      dcf: rawModelWeights?.dcf ?? DEFAULT_MODEL_WEIGHTS.dcf,
      comps: rawModelWeights?.comps ?? DEFAULT_MODEL_WEIGHTS.comps,
      ddm: rawModelWeights?.ddm ?? DEFAULT_MODEL_WEIGHTS.ddm,
    },
    rationale: (raw.weights_rationale as string) ?? '',
  }
}

export interface AgentResult {
  assumptions: Assumptions
  aiConfig: AIRecommendedConfig | null
  fieldCorrections: Record<string, string>
}

function normalizeForecast(rawForecast: unknown): { forecast: Assumptions['forecast']; missingFields: string[] } {
  const forecast = (rawForecast && typeof rawForecast === 'object')
    ? rawForecast as Record<string, unknown>
    : {}
  const missingFields: string[] = []

  if (!Array.isArray(forecast.revenue_forecasts)) missingFields.push('revenue_forecasts')
  if (!Array.isArray(forecast.ebit_margins)) missingFields.push('ebit_margins')
  if (!Array.isArray(forecast.ebitda_margins)) missingFields.push('ebitda_margins')
  if (!Array.isArray(forecast.account_overrides)) missingFields.push('account_overrides')
  if (typeof forecast.effective_tax_rate !== 'number') missingFields.push('effective_tax_rate')
  if (typeof forecast.revenue_thesis !== 'string') missingFields.push('revenue_thesis')
  if (typeof forecast.margin_thesis !== 'string') missingFields.push('margin_thesis')
  if (!Array.isArray(forecast.key_assumptions)) missingFields.push('key_assumptions')

  return {
    forecast: {
      revenue_forecasts: Array.isArray(forecast.revenue_forecasts)
        ? forecast.revenue_forecasts as Assumptions['forecast']['revenue_forecasts']
        : [],
      ebit_margins: Array.isArray(forecast.ebit_margins)
        ? forecast.ebit_margins as Assumptions['forecast']['ebit_margins']
        : [],
      ebitda_margins: Array.isArray(forecast.ebitda_margins)
        ? forecast.ebitda_margins as Assumptions['forecast']['ebitda_margins']
        : [],
      effective_tax_rate: typeof forecast.effective_tax_rate === 'number'
        ? forecast.effective_tax_rate
        : 0.21,
      account_overrides: Array.isArray(forecast.account_overrides)
        ? forecast.account_overrides as Assumptions['forecast']['account_overrides']
        : [],
      revenue_thesis: typeof forecast.revenue_thesis === 'string' ? forecast.revenue_thesis : '',
      margin_thesis: typeof forecast.margin_thesis === 'string' ? forecast.margin_thesis : '',
      key_assumptions: Array.isArray(forecast.key_assumptions)
        ? forecast.key_assumptions as string[]
        : [],
    },
    missingFields,
  }
}

export async function runAgent(
  ticker: string,
  apiKey: string,
  onStep: (entry: AgentLogEntry) => void,
  provider: string = 'anthropic',
  deepResearch: boolean = false,
): Promise<AgentResult> {
  const controller = new AbortController()
  const timeoutMs = deepResearch ? 12 * 60 * 1000 : 8 * 60 * 1000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/analyze/${encodeURIComponent(ticker)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, provider, deep_research: deepResearch }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutMinutes = Math.floor(timeoutMs / 60000)
      const guidance = deepResearch
        ? 'Try Standard mode (faster) or retry in a minute.'
        : 'Please retry in a minute.'
      throw new Error(`Analysis timed out after ${timeoutMinutes} minutes. ${guidance}`)
    }
    throw error
  }

  if (!response.ok) {
    clearTimeout(timeoutId)
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      const text = await response.text().catch(() => response.statusText)
      detail = text || response.statusText
    }
    throw new Error(`Analysis failed: ${detail}`)
  }

  if (!response.body) {
    clearTimeout(timeoutId)
    throw new Error('No response body for SSE stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assumptions: Assumptions | null = null
  let rawValuationConfig: Record<string, unknown> | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE events from buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue

        try {
          const event = JSON.parse(jsonStr)

          if (event.type === 'step') {
            onStep({
              status: 'running',
              text: event.message,
              timestamp: Date.now(),
            })
          } else if (event.type === 'result') {
            onStep({
              status: 'done',
              text: 'Analysis complete',
              timestamp: Date.now(),
            })
            const data = event.data as Record<string, unknown>

            // Fix 6: Structural validation before casting
            if (
              typeof data.dcf !== 'object' || data.dcf === null ||
              typeof data.wacc !== 'object' || data.wacc === null ||
              typeof data.ddm !== 'object' || data.ddm === null ||
              typeof data.comps !== 'object' || data.comps === null ||
              typeof data.scenarios !== 'object' || data.scenarios === null ||
              !Array.isArray((data.dcf as Record<string, unknown>).revenue_growth_rates)
            ) {
              throw new Error('AI returned malformed assumptions -- missing required fields')
            }

            rawValuationConfig = data.valuation_config as Record<string, unknown> | undefined
            const parsed = data as unknown as Assumptions
            const normalizedForecast = normalizeForecast((data as Record<string, unknown>).forecast)
            parsed.forecast = normalizedForecast.forecast
            if (normalizedForecast.missingFields.length > 0) {
              onStep({
                status: 'running',
                text: `Forecast fallback defaults applied: ${normalizedForecast.missingFields.join(', ')}`,
                timestamp: Date.now(),
              })
            }
            assumptions = parsed
          } else if (event.type === 'error') {
            onStep({
              status: 'error',
              text: event.message,
              timestamp: Date.now(),
            })
            throw new Error(event.message)
          }
        } catch (parseError) {
          // Skip malformed SSE lines
          if (parseError instanceof SyntaxError) continue
          throw parseError
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutMinutes = Math.floor(timeoutMs / 60000)
      const guidance = deepResearch
        ? 'Try Standard mode (faster) or retry in a minute.'
        : 'Please retry in a minute.'
      throw new Error(`Analysis timed out after ${timeoutMinutes} minutes. ${guidance}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!assumptions) {
    throw new Error('Agent completed without returning assumptions')
  }

  // Validate and correct Claude's output before engines use it
  const { corrected, warnings, fieldCorrections } = validateAssumptions(assumptions)
  if (warnings.length > 0) {
    onStep({
      status: 'running',
      text: `Validated assumptions: ${warnings.length} correction(s) applied`,
      timestamp: Date.now(),
    })
  }

  return {
    assumptions: corrected,
    aiConfig: parseAIRecommendedConfig(rawValuationConfig),
    fieldCorrections,
  }
}
