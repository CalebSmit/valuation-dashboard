import type { WACCAssumptions } from '../types/Assumptions.ts'
import { formatPercent, formatNumber } from '../utils/formatters.ts'

interface WACCBuildupCardProps {
  wacc: WACCAssumptions
  computedWACC: number
  costOfEquity: number
  afterTaxCostOfDebt: number
}

interface Row {
  component: string
  value: string
  source: string
  emphasis?: boolean
}

export function WACCBuildupCard({ wacc, computedWACC, costOfEquity, afterTaxCostOfDebt }: WACCBuildupCardProps) {
  const rows: Row[] = [
    { component: 'Risk-Free Rate (Rf)', value: formatPercent(wacc.risk_free_rate.value), source: wacc.risk_free_rate.source },
    { component: 'Equity Risk Premium (ERP)', value: formatPercent(wacc.equity_risk_premium.value), source: wacc.equity_risk_premium.source },
    { component: 'Beta (β)', value: formatNumber(wacc.beta.value, 2), source: wacc.beta.source },
    { component: 'Size Premium', value: formatPercent(wacc.size_premium.value), source: wacc.size_premium.source },
    { component: 'Cost of Equity', value: formatPercent(costOfEquity), source: 'Calculated: Rf + β × ERP + Size Premium' },
    { component: 'Cost of Debt (pre-tax)', value: formatPercent(wacc.cost_of_debt.value), source: wacc.cost_of_debt.source },
    { component: 'Tax Rate', value: formatPercent(wacc.tax_rate.value), source: wacc.tax_rate.source },
    { component: 'Cost of Debt (after-tax)', value: formatPercent(afterTaxCostOfDebt), source: 'Calculated: Kd × (1 − Tax)' },
    { component: 'Equity Weight', value: formatPercent(wacc.equity_weight.value), source: wacc.equity_weight.source },
    { component: 'Debt Weight', value: formatPercent(wacc.debt_weight.value), source: wacc.debt_weight.source },
    { component: 'WACC', value: formatPercent(computedWACC), source: 'Calculated: We × Ke + Wd × Kd(1−T)', emphasis: true },
  ]

  return (
    <div className="card p-4">
      <div className="mb-3">
        <h4 className="text-xs uppercase tracking-wider font-mono clr-accent">WACC Build-Up</h4>
        <p className="text-[11px] font-mono clr-muted mt-0.5">
          Each component is traceable to its source.
        </p>
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="row-b">
            <th className="text-left py-2 clr-muted font-normal">Component</th>
            <th className="text-right py-2 clr-muted font-normal">Value</th>
            <th className="text-left py-2 pl-4 clr-muted font-normal">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.component}
              className={row.emphasis ? 'row-t-accent' : 'row-b'}
            >
              <td className={`py-1.5 ${row.emphasis ? 'font-semibold clr-accent' : 'clr-text'}`}>
                {row.component}
              </td>
              <td className={`text-right py-1.5 ${row.emphasis ? 'font-bold clr-accent' : 'clr-text'}`}>
                {row.value}
              </td>
              <td
                className={`py-1.5 pl-4 text-[10px] ${row.emphasis ? 'clr-accent' : 'clr-muted'}`}
                title={row.source}
              >
                {row.source.length > 60 ? row.source.slice(0, 60) + '…' : row.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
