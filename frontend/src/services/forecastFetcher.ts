/**
 * Fetches forecast preset assumptions and base year data from the backend.
 */
import type { PresetAssumptions, BaseYearData } from '../types/ForecastOutput.ts'

export async function fetchForecastPresets(): Promise<{
  presets: PresetAssumptions
  baseYear: BaseYearData
}> {
  const response = await fetch('/api/forecasts/presets')

  if (!response.ok) {
    let detail: string
    try {
      const body = await response.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      detail = response.statusText
    }
    throw new Error(`Failed to fetch forecast presets: ${detail}`)
  }

  const json = await response.json()
  return {
    presets: json.presets as PresetAssumptions,
    baseYear: json.base_year as BaseYearData,
  }
}
