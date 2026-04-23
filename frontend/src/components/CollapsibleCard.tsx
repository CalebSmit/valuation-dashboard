import { useState } from 'react'
import type { ReactNode } from 'react'

interface CollapsibleCardProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

export function CollapsibleCard({ title, children, defaultOpen = false, className }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`card overflow-hidden flex flex-col h-full ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#21262D] transition-colors flex-shrink-0"
      >
        <h4 className="text-xs uppercase tracking-wider font-mono clr-muted m-0">
          {title}
        </h4>
        <span className="text-xs clr-muted">{open ? '\u2014' : '+'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 flex-1 flex flex-col">
          {children}
        </div>
      )}
    </div>
  )
}
