import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { DCFOutput } from '../types/DCFOutput.ts'
import type { DDMOutput } from '../types/DDMOutput.ts'
import type { CompsOutput } from '../types/CompsOutput.ts'
import type { ScenarioOutput } from '../types/ScenarioOutput.ts'
import { FOOTBALL_COLORS } from '../utils/constants.ts'
import { formatCurrency } from '../utils/formatters.ts'

interface FootballFieldProps {
  dcfOutput: DCFOutput | null
  ddmOutput: DDMOutput | null
  compsOutput: CompsOutput | null
  scenarioOutput: ScenarioOutput | null
  currentPrice: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  priceTarget?: number | null
}

interface BarData {
  name: string
  offset: number
  range: number
  mid: number
  fill: string
  applicable: boolean
  tooltip: string
}

export function FootballField({
  dcfOutput,
  ddmOutput,
  compsOutput,
  scenarioOutput,
  currentPrice,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  priceTarget,
}: FootballFieldProps) {
  const bars = useMemo<BarData[]>(() => {
    const result: BarData[] = []

    // DCF range from scenario bear/bull
    if (dcfOutput?.impliedPrice !== null && dcfOutput !== null) {
      const bearDCF = scenarioOutput?.bear.dcfPrice ?? dcfOutput.impliedPrice * 0.8
      const bullDCF = scenarioOutput?.bull.dcfPrice ?? dcfOutput.impliedPrice * 1.2
      const low = Math.min(bearDCF ?? 0, dcfOutput.impliedPrice ?? 0)
      const high = Math.max(bullDCF ?? 0, dcfOutput.impliedPrice ?? 0)
      result.push({
        name: 'DCF',
        offset: Math.max(0, low),
        range: high - Math.max(0, low),
        mid: dcfOutput.impliedPrice ?? 0,
        fill: FOOTBALL_COLORS.dcfBase,
        applicable: true,
        tooltip: `DCF: ${formatCurrency(low)} - ${formatCurrency(high)} (Base: ${formatCurrency(dcfOutput.impliedPrice)})`,
      })
    }

    // DDM
    if (ddmOutput) {
      if (ddmOutput.isApplicable && ddmOutput.impliedPrice !== null) {
        const low = (ddmOutput.singleStagePrice ?? ddmOutput.impliedPrice) * 0.9
        const high = (ddmOutput.twoStagePrice ?? ddmOutput.impliedPrice) * 1.1
        result.push({
          name: 'DDM',
          offset: Math.max(0, Math.min(low, high)),
          range: Math.abs(high - low),
          mid: ddmOutput.impliedPrice,
          fill: FOOTBALL_COLORS.ddm,
          applicable: true,
          tooltip: `DDM: ${formatCurrency(Math.min(low, high))} - ${formatCurrency(Math.max(low, high))}`,
        })
      } else {
        result.push({
          name: 'DDM',
          offset: 0, range: 0, mid: 0,
          fill: FOOTBALL_COLORS.inapplicable,
          applicable: false,
          tooltip: 'DDM not applicable — company does not pay stable dividends',
        })
      }
    }

    // Comps — individual multiples
    if (compsOutput) {
      for (const ip of compsOutput.impliedPrices) {
        if (ip.isApplicable && ip.impliedPrice !== null) {
          const spread = ip.impliedPrice * 0.15
          result.push({
            name: ip.multiple,
            offset: Math.max(0, ip.impliedPrice - spread),
            range: spread * 2,
            mid: ip.impliedPrice,
            fill: ip.multiple.includes('EV') ? FOOTBALL_COLORS.evEbitda : FOOTBALL_COLORS.pe,
            applicable: true,
            tooltip: `${ip.multiple}: ${formatCurrency(ip.impliedPrice)} (Median: ${ip.peerMedian?.toFixed(1)}x)`,
          })
        }
      }
    }

    // 52-Week Range
    if (fiftyTwoWeekLow !== null && fiftyTwoWeekHigh !== null) {
      result.push({
        name: '52-Wk Range',
        offset: fiftyTwoWeekLow,
        range: fiftyTwoWeekHigh - fiftyTwoWeekLow,
        mid: (fiftyTwoWeekHigh + fiftyTwoWeekLow) / 2,
        fill: FOOTBALL_COLORS.fiftyTwoWeek,
        applicable: true,
        tooltip: `52-Week: ${formatCurrency(fiftyTwoWeekLow)} - ${formatCurrency(fiftyTwoWeekHigh)}`,
      })
    }

    return result
  }, [dcfOutput, ddmOutput, compsOutput, scenarioOutput, fiftyTwoWeekHigh, fiftyTwoWeekLow])

  const domain = useMemo<[number, number]>(() => {
    const allValues = bars
      .filter(b => b.applicable && b.range > 0)
      .flatMap(b => [b.offset, b.offset + b.range])
    if (currentPrice !== null) allValues.push(currentPrice)
    if (priceTarget !== null && priceTarget !== undefined) allValues.push(priceTarget)
    if (allValues.length === 0) return [0, 200]
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const padding = (max - min) * 0.12
    return [Math.max(0, min - padding), max + padding]
  }, [bars, currentPrice, priceTarget])

  if (bars.length === 0) {
    return (
      <div className="p-4 text-center font-mono clr-muted text-[13px]">
        No valuation data available
      </div>
    )
  }

  return (
    <div className="w-full" data-export-football-field="true">
      <ResponsiveContainer width="100%" height={Math.max(220, bars.length * 44 + 40)}>
        <BarChart
          layout="vertical"
          data={bars}
          margin={{ top: 10, right: 40, left: 10, bottom: 10 }}
        >
          <XAxis
            type="number"
            domain={domain}
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#8B949E' }}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            axisLine={{ stroke: '#30363D' }}
            tickLine={{ stroke: '#30363D' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono', fill: '#E6EDF3' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.[1]) return null
              const item = payload[1].payload as BarData
              return (
                <div
                  className="px-3 py-2 text-xs football-tooltip"
                >
                  {item.tooltip}
                </div>
              )
            }}
          />
          <Bar dataKey="offset" stackId="range" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="range" stackId="range" radius={[0, 2, 2, 0]}>
            {bars.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.fill}
                fillOpacity={entry.applicable ? 0.8 : 0.2}
              />
            ))}
          </Bar>
          {priceTarget !== null && priceTarget !== undefined && (
            <ReferenceLine
              x={priceTarget}
              stroke="#00FF88"
              strokeWidth={2}
              label={{
                value: `Target $${priceTarget.toFixed(0)}`,
                position: 'top',
                style: { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#00FF88' },
              }}
            />
          )}
          {currentPrice !== null && (
            <ReferenceLine
              x={currentPrice}
              stroke="#F0A500"
              strokeWidth={2}
              strokeDasharray="4 2"
              label={{
                value: `$${currentPrice.toFixed(2)}`,
                position: 'top',
                style: { fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#F0A500' },
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
