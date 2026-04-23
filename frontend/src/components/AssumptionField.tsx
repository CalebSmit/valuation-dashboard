import { useState, useCallback } from 'react'
import { SourceChip } from './SourceChip.tsx'
import type { SourcedAssumption } from '../types/Assumptions.ts'

interface AssumptionFieldProps {
  label: string
  assumption: SourcedAssumption
  format: 'percent' | 'multiple' | 'number'
  onOverride: (newValue: number) => void
  min?: number
  max?: number
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

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-mono text-xs assumption-label">
        {label}
      </span>
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
              className="w-20 px-1.5 py-0.5 text-right font-mono text-sm assumption-input"
            />
            <span className="font-mono text-xs clr-muted">
              {suffix(format)}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEditing(true); setInputVal(displayValue(assumption.value, format)) }}
            className="font-mono text-sm px-1.5 py-0.5 text-right cursor-pointer assumption-value-btn"
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
  )
}
