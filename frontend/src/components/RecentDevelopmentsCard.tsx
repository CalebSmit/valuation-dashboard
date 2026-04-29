import type { NewsItem } from '../types/FinancialData.ts'

interface RecentDevelopmentsCardProps {
  news: NewsItem[] | undefined
}

function formatPublishedDate(value: string): string {
  if (!value) return ''
  // yfinance returns either ISO timestamps or epoch seconds (as string)
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    const ms = numeric < 1e12 ? numeric * 1000 : numeric
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  // Trim verbose ISO strings to YYYY-MM-DD when possible
  const isoMatch = /^\d{4}-\d{2}-\d{2}/.exec(value)
  return isoMatch ? isoMatch[0] : value
}

export function RecentDevelopmentsCard({ news }: RecentDevelopmentsCardProps) {
  if (!news || news.length === 0) return null

  return (
    <div className="p-4 card">
      <h4 className="text-xs uppercase tracking-wider mb-3 font-mono clr-muted">
        Recent Developments
      </h4>
      <ul className="flex flex-col gap-2">
        {news.slice(0, 8).map((item, i) => {
          const date = formatPublishedDate(item.published)
          const isLink = item.link && /^https?:/.test(item.link)
          return (
            <li key={`${item.title}-${i}`} className="text-xs leading-relaxed">
              {date && (
                <span className="font-mono clr-muted mr-2 text-[10px]">
                  {date}
                </span>
              )}
              {isLink ? (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans clr-text hover:text-[#F0A500] underline-offset-2 hover:underline"
                >
                  {item.title}
                </a>
              ) : (
                <span className="font-sans clr-text">{item.title}</span>
              )}
              {item.publisher && (
                <span className="ml-2 font-mono clr-muted text-[10px]">
                  · {item.publisher}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
