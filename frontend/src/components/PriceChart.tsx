import { useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import type { PriceDataPoint } from '../types/FinancialData.ts'
import { formatCurrency } from '../utils/formatters.ts'

interface PriceChartProps {
  priceHistory: PriceDataPoint[]
  currentPrice: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  bullTarget: number | null
  baseTarget: number | null
  bearTarget: number | null
}

interface ChartPoint {
  date: string
  label: string
  close: number | null
  bull: number | null
  base: number | null
  bear: number | null
  forecastRange: [number, number] | null
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`
}

function formatXTick(dateStr: string): string {
  const d = new Date(dateStr)
  if (d.getMonth() === 0) return d.getFullYear().toString()
  return MONTH_NAMES[d.getMonth()]
}

interface EndDotProps {
  cx?: number
  cy?: number
  index?: number
  dataLength: number
  color: string
  label: string
}

function EndDot({ cx, cy, index, dataLength, color, label }: EndDotProps) {
  if (index !== dataLength - 1 || cx === undefined || cy === undefined) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={3} fill={color} />
      <text x={cx + 6} y={cy + 4} fontSize={10} fontFamily="IBM Plex Mono" fill={color}>
        {label}
      </text>
    </g>
  )
}

export function PriceChart({
  priceHistory,
  currentPrice,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  bullTarget,
  baseTarget,
  bearTarget,
}: PriceChartProps) {
  const chartData = useMemo<ChartPoint[]>(() => {
    if (priceHistory.length === 0) return []

    // Trim history to last 3 years
    const lastDate = new Date(priceHistory[priceHistory.length - 1].date)
    const cutoff = new Date(lastDate)
    cutoff.setFullYear(cutoff.getFullYear() - 3)
    const trimmedHistory = priceHistory.filter(p => new Date(p.date) >= cutoff)

    // Historical data points
    const historical: ChartPoint[] = trimmedHistory.map(p => ({
      date: p.date,
      label: formatDateLabel(p.date),
      close: p.close,
      bull: null,
      base: null,
      bear: null,
      forecastRange: null,
    }))

    // Add forecast cone if we have targets
    const hasForecast = bullTarget !== null || baseTarget !== null || bearTarget !== null
    if (!hasForecast || currentPrice === null) return historical

    // Start forecast from current price
    const forecastStart: ChartPoint = {
      date: lastDate.toISOString().slice(0, 10),
      label: formatDateLabel(lastDate.toISOString()),
      close: currentPrice,
      bull: currentPrice,
      base: currentPrice,
      bear: currentPrice,
      forecastRange: [currentPrice, currentPrice],
    }

    // Generate weekly forecast points for 52 weeks (12 months) to match historical density
    const totalForecastDays = 364 // 52 weeks
    const weekStep = 7
    const forecastPoints: ChartPoint[] = []
    for (let day = weekStep; day <= totalForecastDays; day += weekStep) {
      const futureDate = new Date(lastDate)
      futureDate.setDate(futureDate.getDate() + day)
      const pct = day / totalForecastDays

      const bullVal = bullTarget !== null ? currentPrice + (bullTarget - currentPrice) * pct : null
      const baseVal = baseTarget !== null ? currentPrice + (baseTarget - currentPrice) * pct : null
      const bearVal = bearTarget !== null ? currentPrice + (bearTarget - currentPrice) * pct : null

      const rangeVals = [bullVal, baseVal, bearVal].filter((v): v is number => v !== null)
      const rangeMin = rangeVals.length > 0 ? Math.min(...rangeVals) : null
      const rangeMax = rangeVals.length > 0 ? Math.max(...rangeVals) : null

      forecastPoints.push({
        date: futureDate.toISOString().slice(0, 10),
        label: formatDateLabel(futureDate.toISOString()),
        close: null,
        bull: bullVal,
        base: baseVal,
        bear: bearVal,
        forecastRange: rangeMin !== null && rangeMax !== null ? [rangeMin, rangeMax] : null,
      })
    }

    return [...historical, forecastStart, ...forecastPoints]
  }, [priceHistory, currentPrice, bullTarget, baseTarget, bearTarget])

  const yDomain = useMemo<[number, number]>(() => {
    const allValues: number[] = []
    for (const p of chartData) {
      if (p.close !== null) allValues.push(p.close)
      if (p.bull !== null) allValues.push(p.bull)
      if (p.base !== null) allValues.push(p.base)
      if (p.bear !== null) allValues.push(p.bear)
    }
    if (currentPrice !== null) allValues.push(currentPrice)
    if (fiftyTwoWeekHigh !== null) allValues.push(fiftyTwoWeekHigh)
    if (fiftyTwoWeekLow !== null) allValues.push(fiftyTwoWeekLow)
    if (allValues.length === 0) return [0, 100]
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const padding = (max - min) * 0.08
    return [Math.max(0, min - padding), max + padding]
  }, [chartData, currentPrice, fiftyTwoWeekHigh, fiftyTwoWeekLow])

  // Select ticks: one per year (first point on/after Jan 1) + one mid-year (first point on/after Jul 1)
  const tickDates = useMemo(() => {
    if (chartData.length === 0) return []
    const yearsSeen = new Set<number>()
    const midYearsSeen = new Set<number>()
    const dates: string[] = []

    for (const point of chartData) {
      const d = new Date(point.date)
      const month = d.getMonth()
      const year = d.getFullYear()

      // First data point on or after Jan 1 of this year → year label
      if (month <= 1 && !yearsSeen.has(year)) {
        yearsSeen.add(year)
        dates.push(point.date)
      // First data point on or after Jul 1 of this year → mid-year label
      } else if (month >= 6 && month <= 7 && !midYearsSeen.has(year) && yearsSeen.has(year)) {
        midYearsSeen.add(year)
        dates.push(point.date)
      }
    }
    return dates
  }, [chartData])

  if (priceHistory.length === 0) {
    return (
      <div className="p-4 text-center font-mono clr-muted text-[13px]">
        No price history available
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 80, left: 10, bottom: 10 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#8B949E' }}
            tickFormatter={(val: string) => formatXTick(val)}
            ticks={tickDates}
            axisLine={{ stroke: '#30363D' }}
            tickLine={{ stroke: '#30363D' }}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#8B949E' }}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            axisLine={{ stroke: '#30363D' }}
            tickLine={{ stroke: '#30363D' }}
            width={55}
          />
          <Tooltip
            content={({ payload, label }) => {
              if (!payload || payload.length === 0) return null
              const point = payload[0]?.payload as ChartPoint | undefined
              if (!point) return null
              const d = new Date(label as string)
              const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              return (
                <div className="px-3 py-2 text-xs football-tooltip">
                  <div className="clr-muted mb-1">{dateStr}</div>
                  {point.close !== null && (
                    <div className="clr-text">Price: {formatCurrency(point.close)}</div>
                  )}
                  {point.bull !== null && (
                    <div style={{ color: '#3FB950' }}>Bull: {formatCurrency(point.bull)}</div>
                  )}
                  {point.base !== null && (
                    <div className="clr-text">Base: {formatCurrency(point.base)}</div>
                  )}
                  {point.bear !== null && (
                    <div style={{ color: '#F85149' }}>Bear: {formatCurrency(point.bear)}</div>
                  )}
                </div>
              )
            }}
          />

          {/* Forecast cone shaded area */}
          <Area
            dataKey="forecastRange"
            fill="#00FF88"
            fillOpacity={0.08}
            stroke="none"
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* Historical price line */}
          <Line
            dataKey="close"
            stroke="#00FF88"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />

          {/* Forecast lines */}
          <Line
            dataKey="bull"
            stroke="#3FB950"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={(props) => <EndDot {...props} dataLength={chartData.length} color="#3FB950" label={bullTarget !== null ? formatCurrency(bullTarget) : ''} />}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="base"
            stroke="#E6EDF3"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={(props) => <EndDot {...props} dataLength={chartData.length} color="#E6EDF3" label={baseTarget !== null ? formatCurrency(baseTarget) : ''} />}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="bear"
            stroke="#F85149"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={(props) => <EndDot {...props} dataLength={chartData.length} color="#F85149" label={bearTarget !== null ? formatCurrency(bearTarget) : ''} />}
            isAnimationActive={false}
            connectNulls
          />

          {/* Current price reference line */}
          {currentPrice !== null && (
            <ReferenceLine
              y={currentPrice}
              stroke="#F0A500"
              strokeWidth={1}
              strokeDasharray="4 2"
              label={{
                value: `$${currentPrice.toFixed(2)}`,
                position: 'right',
                style: { fontSize: 10, fontFamily: 'IBM Plex Mono', fill: '#F0A500' },
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

    </div>
  )
}
