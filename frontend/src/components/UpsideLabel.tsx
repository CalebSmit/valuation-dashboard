/**
 * Prominent color-coded upside/downside label relative to the current stock price.
 * Green for upside (implied > current), red for downside.
 */
interface UpsideLabelProps {
  impliedPrice: number | null
  currentPrice: number | null
  /** Optional model name for the aria label */
  modelName?: string
}

export function UpsideLabel({ impliedPrice, currentPrice, modelName = 'model' }: UpsideLabelProps) {
  if (impliedPrice === null || currentPrice === null || currentPrice === 0) return null

  const pct = ((impliedPrice - currentPrice) / currentPrice) * 100
  const isUpside = pct >= 0
  const label = isUpside ? `+${pct.toFixed(1)}% UPSIDE` : `${pct.toFixed(1)}% DOWNSIDE`

  return (
    <div
      aria-label={`${modelName} ${isUpside ? 'upside' : 'downside'}: ${pct.toFixed(1)}%`}
      className={`flex flex-col items-center justify-center py-3 px-4 rounded-md mb-4 ${
        isUpside
          ? 'bg-green-950/60 border border-green-700'
          : 'bg-red-950/60 border border-red-700'
      }`}
    >
      <span
        className={`text-3xl font-bold font-mono tracking-tight leading-none ${
          isUpside ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {label}
      </span>
      <span className="text-xs font-mono text-gray-400 mt-1">
        vs. current price of ${currentPrice.toFixed(2)}
      </span>
    </div>
  )
}
