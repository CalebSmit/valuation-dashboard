import { useState } from 'react'

interface WeightSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  color: string
  disabled?: boolean
}

export function WeightSlider({ label, value, onChange, color, disabled }: WeightSliderProps) {
  const pct = Math.round(value * 100)
  const [isAdjusting, setIsAdjusting] = useState(false)

  const colorClass = color === '#F0A500' || color === '#D48E00' || color === '#B87800' || color === '#9C6200'
    ? 'weight-slider-amber'
    : color === '#4493F8' || color === '#2A6FC4'
      ? 'weight-slider-blue'
      : 'weight-slider-green'

  const handleChange = (nextPct: number) => {
    setIsAdjusting(true)
    onChange(nextPct / 100)
  }

  return (
    <div className={`flex items-center gap-3 transition-all ${isAdjusting ? 'weight-slider-active' : ''}`}>
      <span className="text-xs font-mono clr-muted w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={e => handleChange(Number(e.target.value))}
        onMouseLeave={() => setIsAdjusting(false)}
        onMouseUp={() => setIsAdjusting(false)}
        onTouchEnd={() => setIsAdjusting(false)}
        onBlur={() => setIsAdjusting(false)}
        disabled={disabled}
        aria-label={`${label} weight`}
        title={`${label} weight`}
        className={`flex-1 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 weight-slider-track ${colorClass}`}
      />
      <span className={`text-xs font-mono w-10 text-right weight-slider-value ${colorClass}`}>
        {pct}%
      </span>
    </div>
  )
}
