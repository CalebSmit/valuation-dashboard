/**
 * CFA Critique Panel — displays the self-improving critique loop results.
 *
 * Shows:
 * - Overall grade (A-F) with score
 * - Per-category pass/warn/fail status
 * - Expandable issue list per category
 * - "Auto-Refine" button to trigger AI assumption fixes
 * - Changelog of what the AI fixed
 */
import { useState } from 'react'
import type { CritiqueReport, CritiqueCategory, CritiqueIssue, CritiqueSeverity, CritiqueGrade } from '../types/CritiqueResult.ts'

interface CritiquePanelProps {
  report: CritiqueReport | null
  isRunning: boolean
  isRefining: boolean
  refineError: string | null
  refineChanges: string[]
  onRefine: () => void
  onDismissChanges: () => void
  hasApiKey: boolean
}

const GRADE_COLORS: Record<CritiqueGrade, string> = {
  A: 'text-[#3FB950]',
  B: 'text-[#58A6FF]',
  C: 'text-[#F0A500]',
  D: 'text-[#F85149]',
  F: 'text-[#F85149]',
}

const GRADE_BG: Record<CritiqueGrade, string> = {
  A: 'border-[#3FB950]/40 bg-[#3FB950]/5',
  B: 'border-[#58A6FF]/40 bg-[#58A6FF]/5',
  C: 'border-[#F0A500]/40 bg-[#F0A500]/5',
  D: 'border-[#F85149]/40 bg-[#F85149]/5',
  F: 'border-[#F85149]/40 bg-[#F85149]/5',
}

const SEVERITY_COLORS: Record<CritiqueSeverity, string> = {
  critical: 'text-[#F85149]',
  warning: 'text-[#F0A500]',
  info: 'text-[#8B949E]',
}

const SEVERITY_BG: Record<CritiqueSeverity, string> = {
  critical: 'bg-[#F85149]/10 border-[#F85149]/30',
  warning: 'bg-[#F0A500]/10 border-[#F0A500]/30',
  info: 'bg-[#30363D] border-[#30363D]',
}

const SEVERITY_LABELS: Record<CritiqueSeverity, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
}

const CATEGORY_GRADE_ICON: Record<string, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
}

const CATEGORY_GRADE_COLOR: Record<string, string> = {
  pass: 'text-[#3FB950]',
  warn: 'text-[#F0A500]',
  fail: 'text-[#F85149]',
}

function IssueCard({ issue }: { issue: CritiqueIssue }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`rounded border p-3 ${SEVERITY_BG[issue.severity]}`}>
      <button
        type="button"
        className="w-full text-left flex items-start gap-2"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={`text-[10px] font-bold font-mono mt-0.5 shrink-0 ${SEVERITY_COLORS[issue.severity]}`}>
          {SEVERITY_LABELS[issue.severity]}
        </span>
        <span className="text-sm font-medium flex-1">{issue.message}</span>
        <span className="text-xs clr-muted shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 pl-[64px] space-y-1.5">
          <p className="text-xs clr-muted">{issue.detail}</p>
          <div className="flex items-start gap-1.5">
            <span className="text-[10px] font-mono text-[#00FF88] shrink-0 mt-0.5">→</span>
            <p className="text-xs text-[#00FF88]">{issue.suggestion}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryRow({ cat, defaultExpanded }: { cat: CritiqueCategory; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? cat.grade !== 'pass')
  const issues = Array.isArray(cat.issues) ? cat.issues : []

  return (
    <div className="border border-[#30363D] rounded overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#21262D] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-base">{cat.icon}</span>
        <span className="text-sm font-semibold flex-1">{cat.name}</span>
        <span className={`text-sm font-bold font-mono ${CATEGORY_GRADE_COLOR[cat.grade]}`}>
          {CATEGORY_GRADE_ICON[cat.grade]}
          {cat.grade === 'pass' ? ' PASS' : cat.grade === 'warn' ? ` ${issues.length} WARN` : ` ${issues.length} FAIL`}
        </span>
        <span className="text-xs clr-muted ml-2">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && issues.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          {issues.map((issue, idx) => (
            <IssueCard key={`${cat.name}-${issue.check}-${idx}`} issue={issue} />
          ))}
        </div>
      )}

      {expanded && issues.length === 0 && (
        <div className="px-4 pb-3">
          <p className="text-xs text-[#3FB950]">✓ All checks passed</p>
        </div>
      )}
    </div>
  )
}

export function CritiquePanel({
  report,
  isRunning,
  isRefining,
  refineError,
  refineChanges,
  onRefine,
  onDismissChanges,
  hasApiKey,
}: CritiquePanelProps) {
  if (isRunning) {
    return (
      <div className="flex items-center gap-3 p-6">
        <div className="flex gap-1">
          <span className="loading-dot loading-dot-1" />
          <span className="loading-dot loading-dot-2" />
          <span className="loading-dot loading-dot-3" />
        </div>
        <p className="text-sm font-mono clr-muted">Running CFA critique checks...</p>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm clr-muted">Critique will run automatically when analysis is complete.</p>
      </div>
    )
  }

  const issues = Array.isArray(report.issues) ? report.issues : []
  const criticals = issues.filter(i => i.severity === 'critical').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  const severityRank: Record<CritiqueSeverity, number> = { critical: 0, warning: 1, info: 2 }
  const topPriorityIssues = [...issues]
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 3)

  return (
    <div className="flex flex-col gap-5">

      {/* Grade header */}
      <div className={`card p-5 border ${GRADE_BG[report.overall_grade]}`}>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className={`text-5xl font-bold font-mono ${GRADE_COLORS[report.overall_grade]}`}>
              {report.overall_grade}
            </div>
            <div className="text-xs clr-muted font-mono mt-1">{report.overall_score}/100</div>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold mb-1">{report.ticker} — CFA Defensibility Review</h3>
            <p className="text-sm clr-muted">{report.summary}</p>
            <div className="flex gap-4 mt-3">
              {criticals > 0 && (
                <span className="text-xs font-mono text-[#F85149]">
                  ✗ {criticals} Critical
                </span>
              )}
              {warnings > 0 && (
                <span className="text-xs font-mono text-[#F0A500]">
                  ⚠ {warnings} Warning{warnings !== 1 ? 's' : ''}
                </span>
              )}
              {criticals === 0 && warnings === 0 && (
                <span className="text-xs font-mono text-[#3FB950]">
                  ✓ Presentation-ready
                </span>
              )}
            </div>
          </div>

          {/* Auto-refine button */}
          {report.auto_refinable && (
            <div className="shrink-0">
              <button
                type="button"
                disabled={isRefining || !hasApiKey}
                onClick={onRefine}
                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded border transition-colors
                  border-[#00FF88]/50 text-[#00FF88] hover:bg-[#00FF88]/10 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
                title={!hasApiKey ? 'Requires an Anthropic API key in Settings' : 'Use AI to auto-fix failing checks'}
              >
                {isRefining ? 'Refining...' : '⟳ Auto-Refine'}
              </button>
              {!hasApiKey && (
                <p className="text-[10px] clr-muted text-center mt-1">Requires API key</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Refine error */}
      {refineError && (
        <div className="card p-3 border border-[#F85149]/40 bg-[#F85149]/5">
          <p className="text-xs text-[#F85149]">Refinement error: {refineError}</p>
        </div>
      )}

      {/* Priority queue */}
      {topPriorityIssues.length > 0 && (
        <div className="card p-4 border border-[#30363D]">
          <h4 className="text-xs font-semibold font-mono uppercase tracking-wider clr-muted mb-3">
            Priority Fix Queue
          </h4>
          <div className="space-y-2">
            {topPriorityIssues.map((issue, index) => (
              <div key={`${issue.check}-${index}`} className="rounded border border-[#30363D] bg-[#161B22] p-3">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-mono text-[#8B949E] shrink-0">{index + 1}.</span>
                  <span className={`text-[10px] font-bold font-mono mt-0.5 shrink-0 ${SEVERITY_COLORS[issue.severity]}`}>
                    {SEVERITY_LABELS[issue.severity]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#E6EDF3]">{issue.message}</p>
                    <p className="text-xs clr-muted mt-1">{issue.suggestion}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Changes made by last refinement */}
      {refineChanges.length > 0 && (
        <div className="card p-4 border border-[#00FF88]/30 bg-[#00FF88]/5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold font-mono text-[#00FF88] uppercase tracking-wider">
              ✓ Refinement Applied — {refineChanges.length} Change{refineChanges.length !== 1 ? 's' : ''}
            </h4>
            <button
              type="button"
              onClick={onDismissChanges}
              className="text-[10px] clr-muted hover:text-[#E6EDF3]"
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-1">
            {refineChanges.map((change, i) => (
              <li key={i} className="text-xs text-[#E6EDF3] flex gap-2">
                <span className="text-[#00FF88] shrink-0">→</span>
                {change}
              </li>
            ))}
          </ul>
          <p className="text-xs clr-muted mt-3">
            Valuation has been recalculated with revised assumptions. Critique will re-run automatically.
          </p>
        </div>
      )}

      {/* What this checks */}
      <div className="card p-3 border border-[#30363D]">
        <p className="text-[10px] font-mono clr-muted uppercase tracking-wider mb-2">About this review</p>
        <p className="text-xs clr-muted">
          Runs 25+ deterministic checks modelled on CFA Institute Research Challenge judging criteria.
          Covers WACC construction, DCF assumptions, DDM applicability, comparable companies,
          scenario analysis, investment thesis quality, and blend weights.
          Use <strong className="text-[#E6EDF3]">Auto-Refine</strong> to have AI fix flagged issues automatically,
          then review the changes before presenting.
        </p>
      </div>

      {/* Categories */}
      <div className="flex flex-col gap-2">
        {report.categories.map(cat => (
          <CategoryRow key={cat.name} cat={cat} />
        ))}
      </div>
    </div>
  )
}
