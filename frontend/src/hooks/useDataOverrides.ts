import { useState, useMemo, useCallback } from 'react'
import type { FinancialData } from '../types/FinancialData.ts'

export interface DataOverrides {
  revenueLatest?: number
  sharesOutstanding?: number
  totalDebt?: number
  totalCash?: number
  currentPrice?: number
  annualDividendRate?: number
  depreciationAndAmortization?: number
}

export function useDataOverrides(baseData: FinancialData | null) {
  const [overrides, setOverrides] = useState<DataOverrides>({})

  const mergedData = useMemo<FinancialData | null>(() => {
    if (!baseData) return null
    return { ...baseData, ...overrides }
  }, [baseData, overrides])

  const applyDataOverride = useCallback((field: keyof DataOverrides, value: number) => {
    setOverrides(prev => ({ ...prev, [field]: value }))
  }, [])

  const clearDataOverrides = useCallback(() => {
    setOverrides({})
  }, [])

  const dataIsDirty = Object.keys(overrides).length > 0

  return {
    mergedData,
    applyDataOverride,
    clearDataOverrides,
    dataIsDirty,
    dataOverrideCount: Object.keys(overrides).length,
    overrides,
  }
}
