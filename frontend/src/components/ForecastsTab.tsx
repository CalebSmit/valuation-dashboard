/**
 * Forecasts Tab — displays AI-driven 3-statement forecast with editable assumptions.
 */
import { useState, useRef } from 'react'
import type { ForecastOutput, PresetAssumptions, BaseYearData } from '../types/ForecastOutput.ts'
import type { ForecastAssumptions } from '../types/Assumptions.ts'

interface ForecastsTabProps {
  forecastOutput: ForecastOutput | null
  presets: PresetAssumptions | null
  baseYear: BaseYearData | null
  aiForecasts: ForecastAssumptions | null
  onPresetOverride: (key: string, value: number) => void
}

function formatNum(val: number): string {
  if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(1)}B`
  if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(1)}M`
  if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`
  return val.toFixed(2)
}

function formatPct(val: number): string {
  return `${(val * 100).toFixed(1)}%`
}

function EditableCell({
  value, label, format, onSave,
}: {
  value: number | null | undefined
  label: string
  format: 'percent' | 'number' | 'days'
  onSave: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [flash, setFlash] = useState(false)
  const cellRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null)

  // Guard: if the preset value is missing, show N/A and disable editing
  if (value == null || !isFinite(value)) {
    return <span className="px-1 py-0.5 text-xs font-mono clr-muted">N/A</span>
  }

  const displayVal = format === 'percent'
    ? `${(value * 100).toFixed(2)}%`
    : format === 'days'
      ? `${value.toFixed(1)}d`
      : value.toFixed(4)

  const handleCommit = () => {
    const parsed = parseFloat(inputVal)
    if (!isNaN(parsed)) {
      onSave(format === 'percent' ? parsed / 100 : parsed)
      setFlash(true)
      setTimeout(() => setFlash(false), 400)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={el => { cellRef.current = el }}
        type="number"
        step="any"
        autoFocus
        className="w-20 px-1 py-0.5 text-xs font-mono bg-[#0D1117] border border-[#4493F8] rounded text-[#E6EDF3] text-right"
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={e => { if (e.key === 'Enter') handleCommit(); if (e.key === 'Escape') setEditing(false) }}
        title={label}
      />
    )
  }

  return (
    <button
      ref={el => { cellRef.current = el }}
      type="button"
      className={`px-1 py-0.5 text-xs font-mono text-[#4493F8] hover:text-[#00FF88] cursor-pointer bg-transparent border-none text-right rounded transition-colors ${flash ? 'bg-[rgba(0,255,136,0.2)]' : ''}`}
      style={flash ? { animation: 'flash-accent 400ms ease-out' } : {}}
      onClick={() => { setInputVal(format === 'percent' ? (value * 100).toFixed(2) : value.toString()); setEditing(true) }}
      title={`Click to edit: ${label}`}
    >
      {displayVal}
    </button>
  )
}

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ml-1 confidence-dot--${level}`}
      title={`Confidence: ${level}`}
    />
  )
}

function StatementTable({
  title, data, expanded, onToggle,
}: {
  title: string
  data: Record<string, number[]>
  expanded: boolean
  onToggle: () => void
}) {
  // First column is now "LTM Actual" instead of "Base"
  const yearLabels = ['LTM Actual', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5']
  const accounts = Object.keys(data)

  const TOTAL_ROWS = new Set([
    'Total Revenue', 'Gross Profit', 'Operating Income (EBIT)', 'EBITDA',
    'Net Income', 'Total Current Assets', 'Total Assets',
    'Total Current Liabilities', 'Total Liabilities',
    "Stockholders' Equity", 'Total Liabilities & Equity',
    'Operating Cash Flow', 'Free Cash Flow', 'Ending Cash Balance',
  ])

  const isTotalRow = (name: string) => TOTAL_ROWS.has(name)

  return (
    <div className="card p-3">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between mb-2 bg-transparent border-none cursor-pointer">
        <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">{title}</h4>
        <span className="text-xs clr-muted">{expanded ? '[-]' : '[+]'}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="row-b">
                <th className="text-left py-1 px-2 clr-muted w-48">Account</th>
                {yearLabels.map((y, idx) => (
                  <th key={y} className={`text-right py-1 px-2 ${idx === 0 ? 'clr-amber' : 'clr-muted'}`}>{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acct => (
                <tr key={acct} className={`row-b ${isTotalRow(acct) ? 'font-semibold' : ''}`}>
                  <td className="py-1 px-2 clr-text whitespace-nowrap">{acct}</td>
                  {data[acct].map((val, i) => (
                    <td key={i} className={`text-right py-1 px-2 ${i === 0 ? 'clr-amber opacity-80' : isTotalRow(acct) ? 'clr-accent' : 'clr-text'}`}>
                      {formatNum(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ForecastsTab({
  forecastOutput, presets, baseYear, aiForecasts, onPresetOverride,
}: ForecastsTabProps) {
  const [expandedIS, setExpandedIS] = useState(true)
  const [expandedBS, setExpandedBS] = useState(false)
  const [expandedCF, setExpandedCF] = useState(false)
  const [showDCFBridge, setShowDCFBridge] = useState(false)

  if (!forecastOutput || !presets || !baseYear) {
    return <div className="p-4 font-mono text-sm clr-muted">No forecast data available. Run analysis first.</div>
  }

  const { statements, validation } = forecastOutput
  const revenueForecasts = Array.isArray(aiForecasts?.revenue_forecasts) ? [...aiForecasts.revenue_forecasts].sort((a, b) => a.year - b.year) : []
  const ebitMargins = Array.isArray(aiForecasts?.ebit_margins) ? [...aiForecasts.ebit_margins].sort((a, b) => a.year - b.year) : []
  const ebitdaMargins = Array.isArray(aiForecasts?.ebitda_margins) ? [...aiForecasts.ebitda_margins].sort((a, b) => a.year - b.year) : []
  const keyAssumptions = Array.isArray(aiForecasts?.key_assumptions) ? aiForecasts.key_assumptions : []
  const hasAI = revenueForecasts.length > 0

  // Row maxes for sparkline bars
  const revMax = revenueForecasts.length > 0 ? Math.max(...revenueForecasts.map(r => r.value)) : 1
  const ebitMax = ebitMargins.length > 0 ? Math.max(...ebitMargins.map(r => r.value)) : 1
  const ebitdaMax = ebitdaMargins.length > 0 ? Math.max(...ebitdaMargins.map(r => r.value)) : 1

  return (
    <div className="flex flex-col gap-5">
      {/* AI Thesis */}
      {hasAI && (
        <div className="card p-4">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">AI Forecast Thesis</h4>
          {aiForecasts?.revenue_thesis && (
            <div className="mb-2">
              <span className="text-xs font-semibold clr-accent">Revenue: </span>
              <span className="text-xs clr-text">{aiForecasts.revenue_thesis}</span>
            </div>
          )}
          {aiForecasts?.margin_thesis && (
            <div className="mb-2">
              <span className="text-xs font-semibold clr-accent">Margins: </span>
              <span className="text-xs clr-text">{aiForecasts.margin_thesis}</span>
            </div>
          )}
          {keyAssumptions.length > 0 && (
            <div>
              <span className="text-xs font-semibold clr-muted">Key Assumptions: </span>
              <ul className="list-disc list-inside text-xs clr-text mt-1">
                {keyAssumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* AI-Owned Assumptions — with sparkline bars */}
      {hasAI && (
        <div className="card p-4">
          <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">AI-Driven Forecasts</h4>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="row-b">
                <th className="text-left py-1 px-2 clr-muted">Metric</th>
                {[1, 2, 3, 4, 5].map(y => <th key={y} className="text-right py-1 px-2 clr-muted">Y{y}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="row-b">
                <td className="py-1 px-2 clr-text">Revenue</td>
                {revenueForecasts.map(rf => (
                  <td key={rf.year} className="text-right py-1 px-2 clr-accent" title={rf.rationale}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{formatNum(rf.value)}<ConfidenceDot level={rf.confidence} /></span>
                      <div className="w-full flex items-end justify-end" style={{ height: 12 }}>
                        <div className="rounded-t bg-[#00FF88] opacity-50 w-full" style={{ height: `${Math.min(100, Math.max(4, (rf.value / revMax) * 100))}%`, maxHeight: 12, minHeight: 2 }} />
                      </div>
                    </div>
                  </td>
                ))}
              </tr>
              <tr className="row-b">
                <td className="py-1 px-2 clr-text">EBIT Margin</td>
                {ebitMargins.map(em => (
                  <td key={em.year} className="text-right py-1 px-2 clr-text" title={em.rationale}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{formatPct(em.value)}<ConfidenceDot level={em.confidence} /></span>
                      <div className="w-full flex items-end justify-end" style={{ height: 12 }}>
                        <div className="rounded-t bg-[#4493F8] opacity-50 w-full" style={{ height: `${Math.min(100, Math.max(4, (em.value / ebitMax) * 100))}%`, maxHeight: 12, minHeight: 2 }} />
                      </div>
                    </div>
                  </td>
                ))}
              </tr>
              <tr className="row-b">
                <td className="py-1 px-2 clr-text">EBITDA Margin</td>
                {ebitdaMargins.map(em => (
                  <td key={em.year} className="text-right py-1 px-2 clr-text" title={em.rationale}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{formatPct(em.value)}<ConfidenceDot level={em.confidence} /></span>
                      <div className="w-full flex items-end justify-end" style={{ height: 12 }}>
                        <div className="rounded-t bg-[#F0A500] opacity-50 w-full" style={{ height: `${Math.min(100, Math.max(4, (em.value / ebitdaMax) * 100))}%`, maxHeight: 12, minHeight: 2 }} />
                      </div>
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1 px-2 clr-text">Tax Rate</td>
                <td colSpan={5} className="text-right py-1 px-2 clr-text">
                  {formatPct(aiForecasts?.effective_tax_rate ?? 0.21)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Mechanical Assumptions (editable) — with unit hints in labels */}
      <div className="card p-4">
        <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
          Model Assumptions {!hasAI && '(Preset Mode)'}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">CapEx % Rev <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.capex_pct_revenue} label="CapEx % Revenue" format="percent" onSave={v => onPresetOverride('capex_pct_revenue', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">DSO <span className="text-[#8B949E]">(d)</span></span>
            <EditableCell value={presets.dso_days} label="Days Sales Outstanding" format="days" onSave={v => onPresetOverride('dso_days', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">DIO <span className="text-[#8B949E]">(d)</span></span>
            <EditableCell value={presets.dio_days} label="Days Inventory Outstanding" format="days" onSave={v => onPresetOverride('dio_days', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">DPO <span className="text-[#8B949E]">(d)</span></span>
            <EditableCell value={presets.dpo_days} label="Days Payable Outstanding" format="days" onSave={v => onPresetOverride('dpo_days', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">D&A % PP&E <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.da_pct_ppe} label="D&A % of PP&E" format="percent" onSave={v => onPresetOverride('da_pct_ppe', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">SBC % Rev <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.sbc_pct_revenue} label="SBC % Revenue" format="percent" onSave={v => onPresetOverride('sbc_pct_revenue', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">Payout Ratio <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.dividend_payout_ratio} label="Dividend Payout Ratio" format="percent" onSave={v => onPresetOverride('dividend_payout_ratio', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">Cost of Debt <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.cost_of_debt} label="Cost of Debt" format="percent" onSave={v => onPresetOverride('cost_of_debt', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs clr-muted">Tax Rate <span className="text-[#8B949E]">(%)</span></span>
            <EditableCell value={presets.effective_tax_rate} label="Effective Tax Rate" format="percent" onSave={v => onPresetOverride('effective_tax_rate', v)} />
          </div>
        </div>
      </div>

      {/* Validation Badge */}
      <div className={`px-3 py-2 text-xs font-mono rounded ${validation.balanced ? 'bg-[#3FB95020] text-[#3FB950]' : 'bg-[#F8514920] text-[#F85149]'}`}>
        {validation.balanced
          ? `Balance sheet balanced — LTM Actual + Y1–Y5, max diff: $${validation.maxDiff.toFixed(2)}`
          : validation.issues.map((iss, i) => <div key={i}>{iss}</div>)
        }
      </div>

      {/* Soft modeling warnings (e.g. negative implied cash) — surfaced even when BS is balanced */}
      {validation.warnings && validation.warnings.length > 0 && (
        <div className="px-3 py-2 text-xs font-mono rounded bg-[#F0A50020] text-[#F0A500]">
          {validation.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {/* 3 Statements — "Base" renamed to "LTM Actual" */}
      <StatementTable
        title="Forecast Income Statement"
        data={statements.incomeStatement}
        expanded={expandedIS}
        onToggle={() => setExpandedIS(!expandedIS)}
      />
      <StatementTable
        title="Forecast Balance Sheet"
        data={statements.balanceSheet}
        expanded={expandedBS}
        onToggle={() => setExpandedBS(!expandedBS)}
      />
      <StatementTable
        title="Forecast Cash Flow"
        data={statements.cashFlow}
        expanded={expandedCF}
        onToggle={() => setExpandedCF(!expandedCF)}
      />

      {/* DCF Inputs — collapsed by default behind toggle */}
      <div className="card p-3">
        <button
          type="button"
          onClick={() => setShowDCFBridge(s => !s)}
          className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer"
        >
          <h4 className="text-xs uppercase tracking-wider font-mono clr-muted">
            DCF Bridge (Derived Inputs)
          </h4>
          <span className="text-xs font-mono clr-muted border border-[#30363D] px-2 py-0.5 rounded">
            {showDCFBridge ? '[-] Hide' : '[+] Show'}
          </span>
        </button>
        {showDCFBridge && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="row-b">
                  <th className="text-left py-1 px-2 clr-muted w-40">Metric</th>
                  {[1, 2, 3, 4, 5].map(y => <th key={y} className="text-right py-1 px-2 clr-muted">Y{y}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(statements.dcfInputs).map(([metric, values]) => (
                  <tr key={metric} className={`row-b ${metric === 'UFCF' || metric === 'FCFE' ? 'font-semibold' : ''}`}>
                    <td className="py-1 px-2 clr-text">{metric}</td>
                    {values.map((v, i) => (
                      <td key={i} className={`text-right py-1 px-2 ${metric === 'UFCF' || metric === 'FCFE' ? 'clr-accent' : 'clr-text'}`}>
                        {formatNum(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
