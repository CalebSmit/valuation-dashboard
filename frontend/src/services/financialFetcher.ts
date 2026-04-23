/**
 * Fetches financial data from the FastAPI backend.
 * Includes pipeline trigger to auto-run py main.py.
 */
import type { FinancialData, CompetitorData } from '../types/FinancialData.ts'
import type { AgentLogEntry } from '../types/ValuationRun.ts'

export async function fetchFinancialSummary(): Promise<FinancialData> {
  const response = await fetch('/api/financials/summary')

  if (!response.ok) {
    let detail: string
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      detail = response.statusText
    }
    if (response.status === 404) {
      throw new Error(detail || 'raw_data.xlsx not found. Run the Python pipeline first (py main.py).')
    }
    throw new Error(`Failed to fetch financial data: ${detail}`)
  }

  const json = await response.json()
  return json.data as FinancialData
}

export async function fetchSheetNames(): Promise<string[]> {
  const response = await fetch('/api/sheets')

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
  const response = await fetch(`/api/sheets/${encodeURIComponent(sheetName)}`)

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
    response = await fetch(`/api/pipeline/${encodeURIComponent(ticker)}`, {
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
    throw error
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
    throw new Error(`Pipeline failed to start: ${detail}`)
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
              text: event.message,
              timestamp: Date.now(),
            })
            throw new Error(event.message)
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
    `/api/peers?tickers=${tickers.map(encodeURIComponent).join(',')}`
  )
  if (!response.ok) {
    console.warn('Failed to fetch peer data:', response.status)
    return []
  }
  const json = await response.json()
  return json.peers as CompetitorData[]
}

export async function checkHealth(): Promise<{
  status: string
  rawDataExists: boolean
  configuredProviders: string[]
  configuredProviderCount: number
}> {
  const response = await fetch('/api/health')
  const json = await response.json()
  return {
    status: json.status,
    rawDataExists: json.raw_data_exists,
    configuredProviders: json.configured_providers ?? [],
    configuredProviderCount: json.configured_provider_count ?? 0,
  }
}
