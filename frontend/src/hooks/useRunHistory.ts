import { useState, useEffect, useCallback } from 'react'
import type { ValuationRun } from '../types/ValuationRun.ts'
import { getAllRuns, deleteRun as dbDeleteRun } from '../services/database.ts'

export function useRunHistory() {
  const [runs, setRuns] = useState<ValuationRun[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadRuns = useCallback(async () => {
    try {
      const allRuns = await getAllRuns()
      setRuns(allRuns)
    } catch {
      setRuns([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const deleteRun = useCallback(async (id: string) => {
    await dbDeleteRun(id)
    setRuns(prev => prev.filter(r => r.id !== id))
  }, [])

  const refresh = useCallback(() => {
    loadRuns()
  }, [loadRuns])

  return { runs, isLoading, deleteRun, refresh }
}
