interface SourceChipProps {
  source: string
  confidence?: 'high' | 'medium' | 'low'
}

const confidenceClasses: Record<string, string> = {
  high: 'clr-success',
  medium: 'clr-muted',
  low: 'clr-amber',
}

export function SourceChip({ source, confidence = 'medium' }: SourceChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] rounded-sm source-chip ${confidenceClasses[confidence]}`}
      title={source}
    >
      {source.length > 30 ? source.slice(0, 30) + '...' : source}
    </span>
  )
}
