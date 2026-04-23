import { useState, useMemo, useCallback } from 'react'
import type { Assumptions, SourcedAssumption } from '../types/Assumptions.ts'

function setNestedValue(obj: Record<string, unknown>, path: string, value: number): Record<string, unknown> {
  const keys = path.split('.')
  const result = { ...obj }
  let current: Record<string, unknown> = result

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    const nextKey = keys[i + 1]
    const isNextArray = /^\d+$/.test(nextKey)

    if (isNextArray) {
      // Clone the array
      current[key] = [...(current[key] as unknown[])]
    } else {
      current[key] = { ...(current[key] as Record<string, unknown>) }
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = keys[keys.length - 1]
  const existing = current[lastKey]

  // If it's a SourcedAssumption, update just the value field
  if (existing !== null && typeof existing === 'object' && 'value' in (existing as Record<string, unknown>)) {
    current[lastKey] = { ...(existing as SourcedAssumption), value }
  } else {
    current[lastKey] = value
  }

  return result
}

export function useAssumptions(baseAssumptions: Assumptions | null) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  const mergedAssumptions = useMemo<Assumptions | null>(() => {
    if (!baseAssumptions) return null

    let merged = JSON.parse(JSON.stringify(baseAssumptions)) as Record<string, unknown>
    for (const [path, value] of Object.entries(overrides)) {
      merged = setNestedValue(merged, path, value)
    }
    return merged as unknown as Assumptions
  }, [baseAssumptions, overrides])

  const applyOverride = useCallback((path: string, value: number) => {
    setOverrides(prev => ({ ...prev, [path]: value }))
  }, [])

  const clearOverrides = useCallback(() => {
    setOverrides({})
  }, [])

  const isDirty = Object.keys(overrides).length > 0

  return {
    mergedAssumptions,
    applyOverride,
    clearOverrides,
    isDirty,
    overrideCount: Object.keys(overrides).length,
    overrides,
  }
}
