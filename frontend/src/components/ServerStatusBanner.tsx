import { useEffect, useState, useRef } from 'react'
import { checkHealth } from '../services/financialFetcher.ts'

type ConnectionState = 'checking' | 'connected' | 'unreachable'

/**
 * Lightweight keep-alive ping. On page load, checks /api/health once.
 * If the backend is unreachable (Render cold start), shows a banner until
 * it responds. Once connected the banner disappears permanently.
 */
// Show a subtle "Connecting…" banner if the first health check has not
// returned within this window. Render free-tier cold starts can take
// 15–45 s; without a visible signal the user clicks Analyze and gets a
// confusing error before the banner ever appears. We still avoid
// flashing for fast backends with a short grace delay.
const CHECKING_BANNER_DELAY_MS = 1200

export function ServerStatusBanner() {
  const [state, setState] = useState<ConnectionState>('checking')
  const [showCheckingBanner, setShowCheckingBanner] = useState(false)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function ping() {
      if (cancelled) return
      const result = await checkHealth(8000)
      if (cancelled) return

      if (result.reachable) {
        setState('connected')
      } else {
        setState('unreachable')
        attemptRef.current += 1
        // Retry with increasing delay (8s, 12s, 16s, …) up to every 30s
        const delay = Math.min(8000 + attemptRef.current * 4000, 30000)
        retryRef.current = setTimeout(ping, delay)
      }
    }

    const graceTimer = setTimeout(() => {
      if (!cancelled) setShowCheckingBanner(true)
    }, CHECKING_BANNER_DELAY_MS)

    ping()

    return () => {
      cancelled = true
      clearTimeout(graceTimer)
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [])

  if (state === 'connected') return null
  if (state === 'checking' && !showCheckingBanner) return null

  const isChecking = state === 'checking'
  const message = isChecking
    ? 'Connecting to server — Render free tier may take 15–45 s on first request…'
    : 'Connecting to server — the backend is waking up, please wait…'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.625rem',
        padding: '0.5rem 1rem',
        background: '#1c2128',
        borderBottom: '1px solid #30363d',
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        color: '#f0a500',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#f0a500',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      {message}
    </div>
  )
}
