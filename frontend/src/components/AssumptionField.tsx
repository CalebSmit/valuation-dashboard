import { useState, useCallback } from 'react'
import { SourceChip } from './SourceChip.tsx'
import type { SourcedAssumption } from '../types/Assumptions.ts'
import { getRangeWarning } from '../utils/rangeWarnings.ts'

interface AssumptionFieldProps {
  label: string
  assumption: SourcedAssumption
  format: 'percent' | 'multiple' | 'number'
  onOverride: (newValue: number) => void
  min?: number
  max?: number
  /** Correction message from the AI-output validator (e.g. clamping applied). */
  correctionMessage?: string
  /** Which typical-range rule to apply (e.g. "wacc", "beta", "terminalGrowthRate", "ddmPayoutRatio"). */
  rangeRule?: string
  /** Plain-English tooltip shown on hover — one sentence explaining what the number means and why it matters. */
  tooltip?: string
}

function displayValue(value: number, format: string): string {
  switch (format) {
    case 'percent': return (value * 100).toFixed(2)
    case 'multiple': return value.toFixed(1)
    default: return value.toFixed(4)
  }
}

function parseInput(input: string, format: string): number {
  const num = parseFloat(input)
  if (isNaN(num)) return 0
  return format === 'percent' ? num / 100 : num
}

function suffix(format: string): string {
  switch (format) {
    case 'percent': return '%'
    case 'multiple': return 'x'
    default: return ''
  }
}

export function AssumptionField({
  label,
  assumption,
  format,
  onOverride,
  min,
  max,
  correctionMessage,
  rangeRule,
  tooltip,
}: AssumptionFieldProps) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(displayValue(assumption.value, format))
  const [error, setError] = useState('')

  const handleCommit = useCallback(() => {
    const parsed = parseInput(inputVal, format)
    if (min !== undefined && parsed < min) {
      setError(`Min: ${format === 'percent' ? (min * 100).toFixed(1) + '%' : min}`)
      return
    }
    if (max !== undefined && parsed > max) {
      setError(`Max: ${format === 'percent' ? (max * 100).toFixed(1) + '%' : max}`)
      return
    }
    setError('')
    setEditing(false)
    if (parsed !== assumption.value) {
      onOverride(parsed)
    }
  }, [inputVal, format, min, max, assumption.value, onOverride])

  const rangeWarning = getRangeWarning(rangeRule, assumption.value)
  const inputBorderClass = rangeWarning ? 'border border-amber-400' : ''

  return (
    <div className="flex flex-col py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs assumption-label">
            {label}
          </span>
          {tooltip && (
            <span className="relative group inline-flex items-center">
              <span
                aria-label={`Explanation: ${label}`}
                className="flex items-center justify-center w-3.5 h-3.5 text-[9px] rounded-full border border-gray-600 text-gray-400 cursor-help select-none leading-none flex-shrink-0"
              >
                ?
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full mt-1.5 w-64 rounded-md bg-slate-900/95 text-slate-100 text-[11px] font-sans px-3 py-2 shadow-lg border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30 leading-relaxed"
              >
                {tooltip}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={inputVal}
                onChange={e => { setInputVal(e.target.value); setError('') }}
                onBlur={handleCommit}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCommit()
                  if (e.key === 'Escape') { setEditing(false); setInputVal(displayValue(assumption.value, format)) }
                }}
                aria-label={label}
                autoFocus
                className={`w-20 px-1.5 py-0.5 text-right font-mono text-sm assumption-input ${inputBorderClass}`}
              />
              <span className="font-mono text-xs clr-muted">
                {suffix(format)}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setEditing(true); setInputVal(displayValue(assumption.value, format)) }}
              className={`font-mono text-sm px-1.5 py-0.5 text-right cursor-pointer assumption-value-btn ${inputBorderClass}`}
            >
              {displayValue(assumption.value, format)}{suffix(format)}
            </button>
          )}
          <SourceChip source={assumption.source} confidence={assumption.confidence} />
        </div>
        {error && (
          <span className="font-mono text-[10px] clr-red">{error}</span>
        )}
      </div>
      {correctionMessage && (
        <div
          role="alert"
          className="mt-1 px-2 py-1 flex items-start gap-1.5 text-[10px] font-mono rounded-sm bg-yellow-50 border border-yellow-400 text-yellow-800"
        >
          <span aria-hidden="true">⚠️</span>
          <span>Auto-corrected: {correctionMessage}</span>
        </div>
      )}
      {rangeWarning && (
        <div className="mt-1 text-[10px] font-mono text-amber-600">
          ⚠️ {rangeWarning.message}
        </div>
      )}
    </div>
  )
}
