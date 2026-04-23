import type { ValuationRun } from '../types/ValuationRun.ts'
import { format } from 'date-fns'

interface RunHistorySidebarProps {
  runs: ValuationRun[]
  activeRunId: string | null
  onLoadRun: (id: string) => void
  onDeleteRun: (id: string) => void
  isOpen: boolean
  onToggle: () => void
}

export function RunHistorySidebar({
  runs,
  activeRunId,
  onLoadRun,
  onDeleteRun,
  isOpen,
  onToggle,
}: RunHistorySidebarProps) {
  return (
    <div
      className={`flex flex-col h-full overflow-hidden history-panel ${isOpen ? 'history-panel-open' : 'history-panel-closed'}`}
    >
      {/* Toggle button */}
      <button
        type="button"
        onClick={onToggle}
        className="px-3 py-3 text-xs history-toggle-btn"
      >
        {isOpen ? 'History' : '>'}
      </button>

      {isOpen && (
        <div className="flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <div className="p-3 text-xs font-mono clr-muted">
              No past runs
            </div>
          ) : (
            runs.map(run => (
              <div
                key={run.id}
                className={`flex items-center justify-between px-3 py-2 group row-b cursor-pointer ${run.id === activeRunId ? 'history-run-active' : ''}`}
                onClick={() => onLoadRun(run.id)}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-semibold font-mono clr-accent">
                    {run.ticker}
                  </span>
                  <span className="text-[10px] font-mono clr-muted">
                    {format(new Date(run.createdAt), 'MMM d, HH:mm')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onDeleteRun(run.id) }}
                  className="text-xs opacity-0 group-hover:opacity-100 history-run-delete"
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
