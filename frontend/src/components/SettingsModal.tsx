import { useState } from 'react'
import { format } from 'date-fns'
import type { AIProvider } from '../hooks/useSettings.ts'
import type { ValuationRun } from '../types/ValuationRun.ts'

type SettingsTab = 'settings' | 'history'

interface SettingsModalProps {
  currentProvider: AIProvider
  providerConfiguredOnServer: boolean
  currentFredKey: string | null
  onSave: (apiKey: string) => void
  onSaveFredKey: (key: string) => void
  onProviderChange: (provider: AIProvider) => void
  onClose: () => void
  canClose: boolean
  recentRuns: ValuationRun[]
  activeRunId: string | null
  onLoadRun: (id: string) => void
  onDeleteRun: (id: string) => void
}

const PROVIDERS: { id: AIProvider; name: string; placeholder: string; cost: string; description: string }[] = [
  { id: 'anthropic', name: 'Claude', placeholder: 'sk-ant-api03-...', cost: '~$0.01/run', description: 'Best quality, native web search for Deep Research' },
  { id: 'perplexity', name: 'Perplexity', placeholder: 'pplx-...', cost: '~$0.005/run', description: 'Always-on web search, great for real-time citations' },
  { id: 'gemini', name: 'Gemini', placeholder: 'AIza...', cost: '~$0.003/run', description: 'Cheapest option, Google Search grounding available' },
]

export function SettingsModal({
  currentProvider, providerConfiguredOnServer,
  currentFredKey,
  onSave, onSaveFredKey, onProviderChange, onClose, canClose,
  recentRuns, activeRunId, onLoadRun, onDeleteRun,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('settings')
  const [apiKey, setApiKey] = useState('')
  const [fredKey, setFredKey] = useState(currentFredKey ?? '')

  const currentInfo = PROVIDERS.find(p => p.id === currentProvider) ?? PROVIDERS[0]

  const handleSave = () => {
    const trimmedApi = apiKey.trim()
    const trimmedFred = fredKey.trim()
    if (trimmedApi) onSave(trimmedApi)
    if (trimmedFred !== (currentFredKey ?? '')) onSaveFredKey(trimmedFred)
    if (!trimmedApi && trimmedFred !== (currentFredKey ?? '')) onClose()
  }

  const handleLoadRun = (id: string) => {
    onLoadRun(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 modal-backdrop">
      <div className="p-6 w-full modal-panel">
        {/* Top-level tabs: Settings | History */}
        <div className="flex gap-4 mb-4 border-b border-gray-700 pb-2">
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`text-sm font-semibold uppercase tracking-wider font-mono pb-1 ${tab === 'settings' ? 'clr-accent border-b-2 border-current' : 'clr-muted'}`}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`text-sm font-semibold uppercase tracking-wider font-mono pb-1 ${tab === 'history' ? 'clr-accent border-b-2 border-current' : 'clr-muted'}`}
          >
            History
            {recentRuns.length > 0 && (
              <span className="ml-1.5 text-[10px] clr-muted">({recentRuns.length})</span>
            )}
          </button>
        </div>

        {tab === 'settings' && (
          <>
            <h2 className="text-lg font-semibold mb-4 font-mono clr-text">
              AI Provider
            </h2>

            {/* Provider selector */}
            <div className="flex gap-2 mb-4">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onProviderChange(p.id); setApiKey('') }}
                  className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider provider-btn ${currentProvider === p.id ? 'provider-btn-active' : ''}`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Provider info */}
            <div className="mb-4 px-3 py-2 provider-info">
              <p className="text-xs font-sans clr-muted">
                {currentInfo.description}
              </p>
              <p className="text-xs mt-1 font-mono clr-amber">
                Estimated cost: {currentInfo.cost}
              </p>
            </div>

            {/* API key input */}
            <label className="text-xs uppercase tracking-wider mb-1 block font-mono clr-muted">
              {currentInfo.name} API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={currentInfo.placeholder}
              className="w-full p-3 mb-2 text-sm settings-input"
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            />
            <p className="text-[10px] mb-4 font-sans clr-muted">
              {providerConfiguredOnServer
                ? 'This provider is already configured on the backend. Saving a browser key is optional for local-only use.'
                : 'Your key stays local (browser IndexedDB). Never sent to any server except the provider\'s API.'}
            </p>

            {/* FRED API key */}
            <div className="mt-2 pt-4 border-t border-gray-700">
              <label className="text-xs uppercase tracking-wider mb-1 block font-mono clr-muted">
                FRED API Key (optional)
              </label>
              <input
                type="password"
                value={fredKey}
                onChange={e => setFredKey(e.target.value)}
                placeholder="your-fred-api-key"
                className="w-full p-3 mb-2 text-sm settings-input"
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              />
              <p className="text-[10px] mb-4 font-sans clr-muted">
                Free key from fred.stlouisfed.org — enables Treasury yields, GDP, CPI, VIX, and 20+ economic indicators.
                Without it, FRED data will be skipped during pipeline runs.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 text-sm font-semibold uppercase tracking-wider btn-primary"
              >
                Save
              </button>
              {canClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-sm uppercase tracking-wider btn-secondary"
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}

        {tab === 'history' && (
          <>
            <h2 className="text-lg font-semibold mb-4 font-mono clr-text">
              Past Runs
            </h2>
            <div className="settings-history-scroll">
              {recentRuns.length === 0 ? (
                <p className="text-xs font-mono clr-muted py-4">No past runs yet.</p>
              ) : (
                recentRuns.map(r => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between px-3 py-2.5 group row-b cursor-pointer ${r.id === activeRunId ? 'history-run-active' : ''}`}
                    onClick={() => handleLoadRun(r.id)}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold font-mono clr-accent">
                        {r.ticker}
                      </span>
                      <span className="text-[10px] font-mono clr-muted">
                        {format(new Date(r.createdAt), 'MMM d, yyyy HH:mm')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onDeleteRun(r.id) }}
                      className="text-xs opacity-0 group-hover:opacity-100 history-run-delete"
                    >
                      x
                    </button>
                  </div>
                ))
              )}
            </div>
            {canClose && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-sm uppercase tracking-wider btn-secondary"
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
