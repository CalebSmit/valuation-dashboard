import { useState } from 'react'
import { validateTicker } from '../utils/validators.ts'
import type { ValuationRun } from '../types/ValuationRun.ts'
import { format } from 'date-fns'

interface TickerInputProps {
  onAnalyze: (ticker: string, deepResearch: boolean) => void
  onLoadRun: (id: string) => void
  recentRuns: ValuationRun[]
  disabled: boolean
}

export function TickerInput({ onAnalyze, onLoadRun, recentRuns, disabled }: TickerInputProps) {
  const [ticker, setTicker] = useState('')
  const [error, setError] = useState('')
  const [deepResearch, setDeepResearch] = useState(false)

  const handleSubmit = () => {
    const validation = validateTicker(ticker)
    if (!validation.valid) {
      setError(validation.error)
      return
    }
    setError('')
    onAnalyze(ticker.trim().toUpperCase(), deepResearch)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 px-6">
      <div className="text-center">
        <h1
          className="text-4xl font-bold tracking-tight mb-2 ticker-heading"
        >
          VALUATION DASHBOARD
        </h1>
        <p className="text-sm ticker-subheading">
          AI-powered equity analysis
        </p>
      </div>

      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={ticker}
          onChange={e => { setTicker(e.target.value.toUpperCase()); setError('') }}
          placeholder="TICKER"
          maxLength={10}
          disabled={disabled}
          className="p-4 text-2xl text-center w-52 ticker-input"
          onKeyDown={e => { if (e.key === 'Enter' && !disabled) handleSubmit() }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          className="px-8 py-4 text-lg font-bold uppercase tracking-widest analyze-btn"
        >
          ANALYZE
        </button>
      </div>

      {/* Research mode toggle */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setDeepResearch(false)}
          className={`flex items-center gap-2 px-3 py-1.5 research-btn research-btn-standard${!deepResearch ? ' active' : ''}`}
        >
          <span className="research-btn-dot" />
          Standard (~$0.01)
        </button>
        <button
          type="button"
          onClick={() => setDeepResearch(true)}
          className={`flex items-center gap-2 px-3 py-1.5 research-btn research-btn-deep${deepResearch ? ' active' : ''}`}
        >
          <span className="research-btn-dot" />
          Deep Research (~$0.05)
        </button>
      </div>

      {error && (
        <p className="error-text">{error}</p>
      )}

      {recentRuns.length > 0 && (
        <div className="mt-4 w-full recent-runs-container">
          <h3
            className="text-xs uppercase tracking-wider mb-2 recent-runs-heading"
          >
            Recent Runs
          </h3>
          <div className="flex flex-col gap-1">
            {recentRuns.slice(0, 10).map(run => (
              <button
                key={run.id}
                type="button"
                onClick={() => onLoadRun(run.id)}
                className="flex justify-between items-center px-3 py-2 text-left w-full recent-run-btn"
              >
                <span className="recent-run-ticker">{run.ticker}</span>
                <span className="recent-run-date">
                  {format(new Date(run.createdAt), 'MMM d, HH:mm')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
