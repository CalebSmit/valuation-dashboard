import { useState, useEffect, useRef } from 'react'
import type { AgentLogEntry } from '../types/ValuationRun.ts'

interface AgentLogPanelProps {
  entries: AgentLogEntry[]
  isActive: boolean
  cached?: boolean
  usage?: { input_tokens: number; output_tokens: number } | null
}

// Claude 3.5 Sonnet pricing (per 1M tokens)
const INPUT_PRICE_PER_MTOK = 3.0
const OUTPUT_PRICE_PER_MTOK = 15.0

function formatCostUSD(cost: number): string {
  if (cost <= 0) return '$0'
  // Round to 3 significant figures
  const magnitude = Math.pow(10, 2 - Math.floor(Math.log10(cost)))
  const rounded = Math.round(cost * magnitude) / magnitude
  // Show at least 3 decimals for typical small costs
  const decimals = cost < 0.01 ? 4 : cost < 0.1 ? 3 : 2
  return `$${rounded.toFixed(decimals)}`
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US')
}

export function AgentLogPanel({ entries, isActive, cached, usage }: AgentLogPanelProps) {
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
          {!cached && usage && (usage.input_tokens > 0 || usage.output_tokens > 0) && (() => {
            const totalTokens = usage.input_tokens + usage.output_tokens
            const cost =
              (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTOK +
              (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK
            return (
              <div className="mt-2 pt-2 border-t border-gray-700 text-[10px] font-mono clr-muted">
                ~{formatCostUSD(cost)} — {formatTokens(totalTokens)} tokens
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
