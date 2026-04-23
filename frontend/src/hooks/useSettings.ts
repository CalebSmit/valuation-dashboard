/**
 * Manages provider selection, API keys, and app settings stored in IndexedDB.
 */
import { useState, useEffect, useCallback } from 'react'
import { getSetting, saveSetting } from '../services/database.ts'
import { checkHealth } from '../services/financialFetcher.ts'

export type AIProvider = 'anthropic' | 'perplexity' | 'gemini'

interface SettingsState {
  provider: AIProvider
  apiKey: string | null
  fredApiKey: string | null
  serverConfiguredProviders: AIProvider[]
  isSettingsOpen: boolean
  isLoading: boolean
}

const PROVIDER_KEY_PREFIX = 'api_key_'
const FRED_KEY = 'fred_api_key'

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    provider: 'anthropic',
    apiKey: null,
    fredApiKey: null,
    serverConfiguredProviders: [],
    isSettingsOpen: false,
    isLoading: true,
  })

  useEffect(() => {
    async function loadSettings() {
      try {
        const provider = (await getSetting('provider') ?? 'anthropic') as AIProvider
        const key = await getSetting(`${PROVIDER_KEY_PREFIX}${provider}`)
        const fredKey = await getSetting(FRED_KEY)
        const health = await checkHealth().catch((error) => {
          console.warn('Dashboard health check failed during settings load.', error)
          return { configuredProviders: [] as string[] }
        })
        setState(prev => ({
          ...prev,
          provider,
          apiKey: key ?? null,
          fredApiKey: fredKey ?? null,
          serverConfiguredProviders: (health.configuredProviders ?? []) as AIProvider[],
          isSettingsOpen: false,
          isLoading: false,
        }))
      } catch {
        setState(prev => ({ ...prev, isLoading: false }))
      }
    }
    loadSettings()
  }, [])

  const setProvider = useCallback(async (provider: AIProvider) => {
    await saveSetting('provider', provider)
    const key = await getSetting(`${PROVIDER_KEY_PREFIX}${provider}`)
    setState(prev => ({ ...prev, provider, apiKey: key ?? null }))
  }, [])

  const setApiKey = useCallback(async (key: string) => {
    await saveSetting(`${PROVIDER_KEY_PREFIX}${state.provider}`, key)
    setState(prev => ({ ...prev, apiKey: key, isSettingsOpen: false }))
  }, [state.provider])

  const setFredApiKey = useCallback(async (key: string) => {
    await saveSetting(FRED_KEY, key)
    setState(prev => ({ ...prev, fredApiKey: key }))
  }, [])

  const openSettings = useCallback(() => {
    setState(prev => ({ ...prev, isSettingsOpen: true }))
  }, [])

  const closeSettings = useCallback(() => {
    setState(prev => ({ ...prev, isSettingsOpen: false }))
  }, [])

  return {
    provider: state.provider,
    apiKey: state.apiKey,
    fredApiKey: state.fredApiKey,
    serverConfiguredProviders: state.serverConfiguredProviders,
    providerConfiguredOnServer: state.serverConfiguredProviders.includes(state.provider),
    isSettingsOpen: state.isSettingsOpen,
    isLoading: state.isLoading,
    setProvider,
    setApiKey,
    setFredApiKey,
    openSettings,
    closeSettings,
  }
}
