import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/formatters.ts'

interface DeltaIndicatorProps {
  oldValue: number | null
  newValue: number | null
}

export function DeltaIndicator({ oldValue, newValue }: DeltaIndicatorProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const timeoutId = window.setTimeout(() => {
      setVisible(false)
    }, 5000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [oldValue, newValue])

  if (!visible || oldValue === null || newValue === null || oldValue === newValue) {
    return null
  }

  const deltaPct = oldValue !== 0 ? (newValue - oldValue) / oldValue : null
  const deltaClass = newValue > oldValue ? 'clr-success' : 'clr-red'

  return (
    <span className={`delta-indicator ${deltaClass}`}>
      {formatCurrency(oldValue)} -&gt; {formatCurrency(newValue)}
      {deltaPct !== null ? ` (${deltaPct > 0 ? '+' : ''}${(deltaPct * 100).toFixed(1)}%)` : ''}
    </span>
  )
}
