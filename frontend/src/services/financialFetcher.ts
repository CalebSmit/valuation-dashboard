/**
 * Fetches financial data from the FastAPI backend.
 * Includes pipeline trigger to auto-run the data pipeline.
 */
import type { FinancialData, CompetitorData } from '../types/FinancialData.ts'
import type { AgentLogEntry } from '../types/ValuationRun.ts'
import { API_BASE } from '../utils/constants.ts'

/** Classify a raw error message into a user-friendly string. */
export function classifyError(raw: string): string {
  const lower = raw.toLowerCase()

  // Backend cold start / unreachable
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  ) {
    return 'Backend is waking up — please wait 30 seconds and try again.'
  }

  // Ticker not found or delisted
  if (
    lower.includes('no data') ||
    lower.includes('not found') ||
    lower.includes('invalid ticker') ||
    lower.includes('delisted') ||
    lower.includes('no price data') ||
    lower.includes('yfinance') ||
    lower.includes('no history found')
  ) {
    return 'Ticker not found or no data available. Check the symbol and try again.'
  }

  // Anthropic API key errors
  if (
    lower.includes('invalid api key') ||
    lower.includes('authentication') ||
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('no api key available') ||
    lower.includes('invalid x-api-key') ||
    lower.includes('api_key')
  ) {
    return 'Invalid API key — check your key in Settings.'
  }

  // Pipeline already running
  if (lower.includes('already running') || lower.includes('pipeline is currently running')) {
    return 'A data pipeline is already running. Please wait for it to finish, then try again.'
  }

  return raw
}

export async function fetchFinancialSummary(): Promise<FinancialData> {
  const response = await fetch(`${API_BASE}/api/financials/summary`)

  if (!response.ok) {
    let detail: string
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      detail = response.statusText
    }
    if (response.status === 404) {
      throw new Error(classifyError(detail || 'Ticker not found or no data available.'))
    }
    throw new Error(classifyError(`Failed to fetch financial data: ${detail}`))
  }

  const json = await response.json()
  return json.data as FinancialData
}

export async function fetchSheetNames(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/sheets`)

  if (!response.ok) {
    throw new Error('Failed to fetch sheet list')
  }

  const json = await response.json()
  return json.sheets as string[]
}

export async function fetchSheet(sheetName: string): Promise<{
  columns: string[]
  data: Record<string, unknown>[]
}> {
  const response = await fetch(`${API_BASE}/api/sheets/${encodeURIComponent(sheetName)}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch sheet: ${sheetName}`)
  }

  return response.json()
}

export async function runPipeline(
  ticker: string,
  onStep: (entry: AgentLogEntry) => void,
  fredApiKey?: string,
): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 min

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/pipeline/${encodeURIComponent(ticker)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fred_api_key: fredApiKey ?? null }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Pipeline timed out after 10 minutes.')
    }
    throw new Error(classifyError(error instanceof Error ? error.message : String(error)))
  }

  if (!response.ok) {
    clearTimeout(timeoutId)
    let detail: string
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      const text = await response.text().catch(() => response.statusText)
      detail = text || response.statusText
    }
    throw new Error(classifyError(`Pipeline failed to start: ${detail}`))
  }

  if (!response.body) {
    clearTimeout(timeoutId)
    throw new Error('No response body for pipeline SSE stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue

        try {
          const event = JSON.parse(jsonStr)

          if (event.type === 'pipeline') {
            onStep({
              status: 'running',
              text: event.message,
              timestamp: Date.now(),
            })
          } else if (event.type === 'pipeline_complete') {
            onStep({
              status: 'done',
              text: event.message,
              timestamp: Date.now(),
            })
          } else if (event.type === 'error') {
            onStep({
              status: 'error',
              text: classifyError(event.message),
              timestamp: Date.now(),
            })
            throw new Error(classifyError(event.message))
          }
        } catch (parseError) {
          if (parseError instanceof SyntaxError) continue
          throw parseError
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Pipeline timed out after 10 minutes.')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchPeerData(tickers: string[]): Promise<CompetitorData[]> {
  if (tickers.length === 0) return []
  const response = await fetch(
    `${API_BASE}/api/peers?tickers=${tickers.map(encodeURIComponent).join(',')}`
  )
  if (!response.ok) {
    console.warn('Failed to fetch peer data:', response.status)
    return []
  }
  const json = await response.json()
  return json.peers as CompetitorData[]
}

/**
 * Check backend health. Resolves to a partial result on network error so the
 * caller can treat an unreachable backend as "no configured providers".
 */
export async function checkHealth(timeoutMs = 8000): Promise<{
  status: string
  rawDataExists: boolean
  configuredProviders: string[]
  configuredProviderCount: number
  reachable: boolean
}> {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${API_BASE}/api/health`, { signal: controller.signal })
    clearTimeout(timerId)
    const json = await response.json()
    return {
      status: json.status,
      rawDataExists: json.raw_data_exists,
      configuredProviders: json.configured_providers ?? [],
      configuredProviderCount: json.configured_provider_count ?? 0,
      reachable: true,
    }
  } catch {
    clearTimeout(timerId)
    return {
      status: 'unreachable',
      rawDataExists: false,
      configuredProviders: [],
      configuredProviderCount: 0,
      reachable: false,
    }
  }
}
