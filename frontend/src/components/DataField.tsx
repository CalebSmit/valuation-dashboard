import { useState, useCallback } from 'react'

interface DataFieldProps {
  label: string
  value: number | null
  originalValue: number | null
  format: 'currency' | 'number' | 'percent'
  onOverride: (value: number) => void
}

function displayVal(value: number | null, format: string): string {
  if (value === null || value === undefined) return 'N/A'
  switch (format) {
    case 'currency': {
      const abs = Math.abs(value)
      if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`
      if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`
      if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
      return value.toFixed(2)
    }
    case 'percent': return (value * 100).toFixed(2)
    default: return value.toLocaleString()
  }
}

function parseVal(input: string, format: string): number | null {
  let cleaned = input.trim().replace(/[,$]/g, '')
  if (!cleaned) return null

  // Handle suffixes
  const upper = cleaned.toUpperCase()
  let multiplier = 1
  if (upper.endsWith('T')) { multiplier = 1e12; cleaned = cleaned.slice(0, -1) }
  else if (upper.endsWith('B')) { multiplier = 1e9; cleaned = cleaned.slice(0, -1) }
  else if (upper.endsWith('M')) { multiplier = 1e6; cleaned = cleaned.slice(0, -1) }
  else if (upper.endsWith('K')) { multiplier = 1e3; cleaned = cleaned.slice(0, -1) }

  const num = parseFloat(cleaned)
  if (isNaN(num)) return null

  const result = num * multiplier
  return format === 'percent' ? result / 100 : result
}

export function DataField({ label, value, originalValue, format, onOverride }: DataFieldProps) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const isOverridden = originalValue !== null && value !== originalValue

  const handleCommit = useCallback(() => {
    const parsed = parseVal(inputVal, format)
    if (parsed !== null) {
      onOverride(parsed)
    }
    setEditing(false)
  }, [inputVal, format, onOverride])

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-mono text-xs data-field-label">
        {label}
        {isOverridden && <span className="ml-1 text-[9px] clr-amber">(override)</span>}
      </span>
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCommit()
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
            className="w-24 px-1.5 py-0.5 text-right font-mono text-sm assumption-input"
            placeholder={displayVal(originalValue, format)}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditing(true); setInputVal(displayVal(value, format)) }}
            className="font-mono text-sm px-1.5 py-0.5 text-right cursor-pointer assumption-value-btn"
          >
            {displayVal(value, format)}{format === 'percent' ? '%' : ''}
          </button>
        )}
      </div>
    </div>
  )
}
