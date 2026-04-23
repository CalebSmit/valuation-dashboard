interface OnboardingGuideProps {
  hasApiKey: boolean
  onOpenSettings: () => void
}

const STEPS = [
  {
    title: 'Configure AI Provider',
    detail: 'Add an API key for Claude, Perplexity, or Gemini before starting a valuation run.',
  },
  {
    title: 'Enter A Ticker',
    detail: 'Use the subject company ticker — e.g. try AAPL, MSFT, or NVDA — including supported formats like BRK.B or 9988.HK.',
  },
  {
    title: 'Run Analyze',
    detail: 'The dashboard fetches live financial data, asks the AI agent for valuation assumptions, and computes DCF, DDM, and Comps models automatically.',
  },
  {
    title: 'Review The Tabs',
    detail: 'Check DCF, DDM, Comps, scenarios, and exports after the run completes. Each tab shows a color-coded upside/downside label vs. the current stock price.',
  },
] as const

export function OnboardingGuide({ hasApiKey, onOpenSettings }: OnboardingGuideProps) {
  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-10">
      <div className="w-full max-w-4xl onboarding-shell">
        <div className="onboarding-hero card">
          <div>
            <p className="onboarding-eyebrow">First-Time Setup</p>
            <h1 className="onboarding-title">Prepare the dashboard before your first valuation run.</h1>
            <p className="onboarding-copy">
              This tool is an AI-powered equity valuation dashboard. You type in a stock ticker
              (e.g. <span className="font-semibold text-slate-200">AAPL</span>,{' '}
              <span className="font-semibold text-slate-200">MSFT</span>, or{' '}
              <span className="font-semibold text-slate-200">NVDA</span>), and the dashboard
              automatically pulls live financial data, generates realistic valuation assumptions
              using an AI agent, and runs three complementary models — Discounted Cash Flow (DCF),
              Dividend Discount Model (DDM), and Comparable Company Analysis (Comps) — to estimate
              what the stock is intrinsically worth relative to its current market price.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider btn-primary"
          >
            {hasApiKey ? 'Provider Configured' : 'Open Settings'}
          </button>
        </div>

        <div className="onboarding-grid">
          {STEPS.map((step, index) => {
            const completed = index === 0 ? hasApiKey : false
            return (
              <div key={step.title} className="card onboarding-step">
                <div className="onboarding-step-header">
                  <span className={`onboarding-step-index ${completed ? 'onboarding-step-complete' : ''}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={`onboarding-step-status ${completed ? 'clr-success' : 'clr-muted'}`}>
                    {completed ? 'Ready' : 'Pending'}
                  </span>
                </div>
                <h2 className="onboarding-step-title">{step.title}</h2>
                <p className="onboarding-step-copy">{step.detail}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
