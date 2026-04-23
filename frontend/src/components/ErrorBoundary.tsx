import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  errorMessage: string
}

/**
 * Top-level error boundary. Catches any uncaught React render errors and
 * shows a friendly "Something went wrong" screen instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: unknown): State {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.'
    return { hasError: true, errorMessage }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console for developer debugging — no API key is involved here
    console.error('[ErrorBoundary] Uncaught render error:', error)
    console.error('[ErrorBoundary] Component stack:', info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
            padding: '2rem',
            background: '#0d1117',
            color: '#e6edf3',
            fontFamily: 'monospace',
          }}
        >
          <div style={{ fontSize: '2rem', color: '#f85149', fontWeight: 700 }}>
            SOMETHING WENT WRONG
          </div>
          <p style={{ fontSize: '0.875rem', maxWidth: '480px', textAlign: 'center', color: '#8b949e' }}>
            An unexpected error crashed the dashboard. This is likely a one-time glitch.
          </p>
          {this.state.errorMessage && (
            <pre
              style={{
                fontSize: '0.75rem',
                maxWidth: '600px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#f85149',
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '1rem',
              }}
            >
              {this.state.errorMessage}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '0.625rem 1.5rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              background: 'transparent',
              border: '1px solid #30363d',
              borderRadius: '4px',
              color: '#e6edf3',
              cursor: 'pointer',
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
