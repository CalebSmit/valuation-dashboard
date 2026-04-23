interface ErrorStateProps {
  error: string
  onRetry: () => void
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 error-card">
      <div className="text-3xl mb-3 font-mono clr-red">ERROR</div>
      <p className="text-sm mb-4 max-w-md text-center font-mono clr-text">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-2 text-xs font-semibold uppercase tracking-wider btn-retry"
      >
        Retry
      </button>
    </div>
  )
}
