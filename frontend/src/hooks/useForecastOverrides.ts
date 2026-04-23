/**
 * Manages user overrides for forecast preset assumptions.
 * Flat key-value store: "capex_pct_revenue" -> 0.06, "ebit_margin_y1" -> 0.28
 */
import { useState, useMemo, useCallback } from 'react'
import type { PresetAssumptions, BaseYearData, ForecastOutput } from '../types/ForecastOutput.ts'
import type { ForecastAssumptions } from '../types/Assumptions.ts'
import { computeForecast } from '../services/forecastEngine.ts'

export function useForecastOverrides(
  presets: PresetAssumptions | null,
  baseYear: BaseYearData | null,
  aiForecasts: ForecastAssumptions | null,
) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  const forecastOutput = useMemo<ForecastOutput | null>(() => {
    if (!presets || !baseYear) return null
    return computeForecast(baseYear, presets, aiForecasts, overrides)
  }, [presets, baseYear, aiForecasts, overrides])

  const applyForecastOverride = useCallback((key: string, value: number) => {
    setOverrides(prev => ({ ...prev, [key]: value }))
  }, [])

  const clearForecastOverrides = useCallback(() => {
    setOverrides({})
  }, [])

  return {
    forecastOutput,
    forecastOverrides: overrides,
    applyForecastOverride,
    clearForecastOverrides,
    forecastIsDirty: Object.keys(overrides).length > 0,
    forecastOverrideCount: Object.keys(overrides).length,
  }
}
