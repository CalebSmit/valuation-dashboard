/**
 * Manages the CFA critique loop:
 * 1. Auto-runs critique whenever a run reaches 'complete'
 * 2. Exposes refine() to trigger AI assumption fixes
 * 3. Returns updated assumptions so the caller can recalculate
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { ValuationRun } from '../types/ValuationRun.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { CritiqueReport, CritiqueIssue } from '../types/CritiqueResult.ts'
import { API_BASE } from '../utils/constants.ts'

export interface UseCritiqueResult {
  report: CritiqueReport | null
  isRunning: boolean
  isRefining: boolean
  refineError: string | null
  refineChanges: string[]
  /** Call after a completed run to trigger refine + get back revised assumptions */
  refine: (
    apiKey: string | null,
    provider: string,
    onRevised: (assumptions: Assumptions) => void,
  ) => Promise<void>
  dismissRefineChanges: () => void
}

function buildCritiquePayload(run: ValuationRun) {
  return {
    ticker: run.ticker,
    assumptions: run.assumptions,
    dcf_output: run.dcfOutput,
    ddm_output: run.ddmOutput,
    comps_output: run.compsOutput,
    scenario_output: run.scenarioOutput,
    financial_data: run.financialData,
  }
}

export function useCritique(run: ValuationRun | null): UseCritiqueResult {
  const [report, setReport] = useState<CritiqueReport | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isRefining, setIsRefining] = useState(false)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [refineChanges, setRefineChanges] = useState<string[]>([])

  // Track which run ID we last critiqued to avoid re-running on unrelated re-renders
  const lastCritiquedRunId = useRef<string | null>(null)

  // Auto-run critique whenever a run reaches 'complete'
  useEffect(() => {
    if (!run || run.status !== 'complete' || !run.assumptions) return
    if (lastCritiquedRunId.current === run.id) return

    lastCritiquedRunId.current = run.id
    setIsRunning(true)
    setReport(null)

    const payload = buildCritiquePayload(run)

    fetch(`${API_BASE}/api/critique`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail ?? `Critique failed (${res.status})`)
        }
        return res.json() as Promise<CritiqueReport>
      })
      .then(data => {
        setReport(data)
      })
      .catch(err => {
        console.warn('[Critique] Failed:', err)
      })
      .finally(() => {
        setIsRunning(false)
      })
  }, [run?.id, run?.status])

  // Reset when a new run starts
  useEffect(() => {
    if (run?.status === 'fetching' || run?.status === 'researching') {
      setReport(null)
      setRefineError(null)
      setRefineChanges([])
      lastCritiquedRunId.current = null
    }
  }, [run?.status])

  const refine = useCallback(
    async (
      apiKey: string | null,
      provider: string,
      onRevised: (assumptions: Assumptions) => void,
    ) => {
      if (!run?.assumptions || !report) return

      // Only send actionable issues (critical + warning)
      const actionableIssues: CritiqueIssue[] = report.issues.filter(
        i => i.severity === 'critical' || i.severity === 'warning',
      )
      if (actionableIssues.length === 0) return

      setIsRefining(true)
      setRefineError(null)
      setRefineChanges([])

      try {
        // API key travels in an Authorization header so it stays out of
        // request bodies / FastAPI 422 echoes / access logs.
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const trimmedKey = apiKey?.trim()
        if (trimmedKey) {
          headers.Authorization = `Bearer ${trimmedKey}`
        }
        const res = await fetch(`${API_BASE}/api/refine`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ticker: run.ticker,
            assumptions: run.assumptions,
            issues: actionableIssues,
            financial_data: run.financialData,
            provider,
          }),
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail ?? `Refinement failed (${res.status})`)
        }

        const data = await res.json()
        const revised = data.revised_assumptions as Assumptions
        const changes: string[] = data.changes_made ?? []
        setRefineChanges(changes)

        // Notify caller so it can recalculate with revised assumptions
        onRevised(revised)

        // Re-run critique against the revised assumptions (optimistic: clear old report)
        setReport(null)
        lastCritiquedRunId.current = null
      } catch (err) {
        setRefineError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsRefining(false)
      }
    },
    [run, report],
  )

  const dismissRefineChanges = useCallback(() => {
    setRefineChanges([])
  }, [])

  return { report, isRunning, isRefining, refineError, refineChanges, refine, dismissRefineChanges }
}
