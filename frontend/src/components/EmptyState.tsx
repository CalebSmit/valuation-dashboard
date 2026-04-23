export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="text-6xl mb-4 empty-icon">$</div>
      <h2 className="text-lg font-semibold mb-2 empty-title">No Valuations Yet</h2>
      <p className="text-sm max-w-md font-sans clr-muted">
        Enter a stock ticker above and click ANALYZE to generate your first AI-powered valuation.
        Make sure you've run the Python pipeline first (py main.py) to populate financial data.
      </p>
    </div>
  )
}
