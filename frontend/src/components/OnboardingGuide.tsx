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
    detail: 'Use the subject company ticker, including supported formats like BRK.B or 9988.HK.',
  },
  {
    title: 'Run Analyze',
    detail: 'The dashboard will refresh raw_data.xlsx, ask the agent for assumptions, and compute every model.',
  },
  {
    title: 'Review The Tabs',
    detail: 'Check DCF, DDM, comps, scenarios, and exports after the run completes.',
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
              The workflow is straightforward: connect a provider, analyze a ticker, then review and export the valuation output.
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
