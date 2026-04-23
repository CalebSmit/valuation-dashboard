import { useState } from 'react'
import type { ReactNode } from 'react'

interface CalcBreakdownProps {
  /** The formula string with actual values plugged in */
  formula: ReactNode
}

/**
 * Collapsible "How this number was calculated" card shown at the bottom of
 * DCF, DDM, and Comps result cards. Defaults to collapsed.
 */
export function CalcBreakdown({ formula }: CalcBreakdownProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3 pt-3 border-t border-gray-700/50">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[11px] font-mono text-gray-400 hover:text-gray-200 transition-colors w-full text-left"
      >
        <span className="text-gray-500">{open ? '▾' : '▸'}</span>
        How this number was calculated
      </button>
      {open && (
        <div className="mt-2 px-3 py-2 rounded bg-slate-900/70 border border-slate-700 text-[11px] font-mono text-slate-300 leading-relaxed">
          {formula}
        </div>
      )}
    </div>
  )
}
