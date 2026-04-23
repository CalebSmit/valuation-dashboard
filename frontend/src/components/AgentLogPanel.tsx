import { useState, useEffect, useRef } from 'react'
import type { AgentLogEntry } from '../types/ValuationRun.ts'

interface AgentLogPanelProps {
  entries: AgentLogEntry[]
  isActive: boolean
}

export function AgentLogPanel({ entries, isActive }: AgentLogPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(entries.length)

  // Auto-expand when a new run starts (entries reset to low count)
  useEffect(() => {
    if (entries.length < prevCountRef.current) {
      setCollapsed(false)
    }
    prevCountRef.current = entries.length
  }, [entries.length])

  // Auto-scroll to bottom as new entries arrive
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length, collapsed])

  if (!isActive) return null

  return (
    <div
      className={`agent-panel border-t ${collapsed ? 'agent-panel--collapsed' : 'agent-panel--expanded'}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer select-none row-b"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider font-mono clr-muted">
          Research Activity
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono clr-muted">
            {entries.length}
          </span>
          <span className="text-xs clr-muted">
            {collapsed ? '+' : '\u2014'}
          </span>
        </div>
      </button>
      {!collapsed && (
        <div ref={scrollRef} className="overflow-y-auto px-4 py-1 agent-log-scroll">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-2 py-1.5 agent-log-entry"
            >
              <span
                className="status-dot mt-1 flex-shrink-0"
                data-status={entry.status}
              />
              <span className={`text-xs leading-relaxed font-mono ${entry.status === 'error' ? 'clr-red' : 'clr-text'}`}>
                {entry.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
