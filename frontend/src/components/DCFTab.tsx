import type { DCFOutput } from '../types/DCFOutput.ts'
import type { Assumptions } from '../types/Assumptions.ts'
import type { FinancialData } from '../types/FinancialData.ts'
import type { DataOverrides } from '../hooks/useDataOverrides.ts'
import type { DCFConfig } from '../types/ValuationConfig.ts'
import { CashFlowBasis, DiscountingConvention } from '../types/ValuationConfig.ts'
import { CollapsibleCard } from './CollapsibleCard.tsx'
import { AssumptionField } from './AssumptionField.tsx'
import { DataField } from './DataField.tsx'
import { DeltaIndicator } from './DeltaIndicator.tsx'
import { WACCBuildupCard } from './WACCBuildupCard.tsx'
import { formatCurrency, formatPercent, formatMillions } from '../utils/formatters.ts'
import { BOUNDS } from '../utils/constants.ts'
import { computeROIC } from '../utils/financialMath.ts'

interface DCFTabProps {
  dcfOutput: DCFOutput | null
  assumptions: Assumptions
  financialData: FinancialData | null
  originalData: FinancialData | null
  previousPrice: number | null
  onOverride: (path: string, value: number) => void
  onDataOverride: (field: keyof DataOverrides, value: number) => void
  dcfConfig: DCFConfig
  onDCFConfigChange: (partial: Partial<DCFConfig>) => void
  fieldCorrections?: Record<string, string>
}

export function DCFTab({
  dcfOutput, assumptions, financialData, originalData, previousPrice,
  onOverride, onDataOverride,
  dcfConfig, onDCFConfigChange,
  fieldCorrections = {},
}: DCFTabProps) {
  const cx = fieldCorrections
  if (!dcfOutput) {
    return <div className="p-4 font-mono text-sm clr-muted">No DCF data available</div>
  }

  const { wacc: waccA, dcf: dcfA } = assumptions
  const roic = computeROIC(
    financialData?.operatingIncome ?? null,
    dcfA.tax_rate.value,
    financialData?.totalDebt ?? null,
    financialData?.totalEquity ?? null,
    financialData?.totalCash ?? null,
  )
  const showRoicWarning = roic !== null && dcfA.terminal_growth_rate.value > roic

  return (
    <div className="flex flex-col gap-4">
      {/* WACC Build-Up summary — prominent traceability card */}
      <WACCBuildupCard
        wacc={waccA}
        computedWACC={dcfOutput.wacc}
        costOfEquity={dcfOutput.costOfEquity}
        afterTaxCostOfDebt={dcfOutput.afterTaxCostOfDebt}
      />
      {/* Two-column grid of collapsible cards */}
      <div className="dcf-grid">
        {/* DCF Valuation — top left, open by default */}
        <CollapsibleCard title="DCF Valuation" defaultOpen>
          {showRoicWarning && (
            <div className="mb-3 px-3 py-2 dcf-warning">
              Terminal growth exceeds current ROIC. Review the terminal value assumptions before relying on this output.
            </div>
          )}
          <table className="w-full text-xs font-mono">
            <tbody>
              {[
                ['PV of FCFs', formatMillions(dcfOutput.pvFCFTotal)],
                ['PV Terminal (Gordon)', formatMillions(dcfOutput.pvTerminalGordon)],
                ['PV Terminal (Exit Multiple)', formatMillions(dcfOutput.pvTerminalExitMultiple)],
                ['EV (Gordon)', formatMillions(dcfOutput.enterpriseValueGordon)],
                ['EV (Exit Multiple)', formatMillions(dcfOutput.enterpriseValueExitMultiple)],
                ['Net Debt', formatMillions(dcfOutput.netDebt)],
                ['ROIC', roic !== null ? formatPercent(roic) : 'N/A'],
                ['Shares Outstanding', (dcfOutput.sharesOutstanding / 1e6).toFixed(0) + 'M'],
              ].map(([label, value]) => (
                <tr key={label} className="row-b">
                  <td className="py-1.5 clr-muted">{label}</td>
                  <td className="text-right py-1.5 clr-text">{value}</td>
                </tr>
              ))}
              <tr className="row-t-accent">
                <td className="py-2 font-semibold clr-accent">Gordon</td>
                <td className="text-right py-2 font-bold text-base clr-accent">{formatCurrency(dcfOutput.impliedPriceGordon)}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold clr-accent">Exit Multiple</td>
                <td className="text-right py-2 font-bold text-base clr-accent">{formatCurrency(dcfOutput.impliedPriceExitMultiple)}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold clr-accent">Blended</td>
                <td className="text-right py-2 font-bold text-base clr-accent">
                  <div className="flex flex-col items-end gap-1">
                    <span>{formatCurrency(dcfOutput.impliedPrice)}</span>
                    <DeltaIndicator oldValue={previousPrice} newValue={dcfOutput.impliedPrice} />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </CollapsibleCard>

        {/* FCF Projection — top right, open by default */}
        <CollapsibleCard title="Free Cash Flow Projection" defaultOpen>
          <div className="overflow-x-auto flex-1">
            <table className="w-full h-full text-xs font-mono">
              <thead>
                <tr className="row-b">
                  <th className="text-left py-2 clr-muted">Year</th>
                  <th className="text-right py-2 clr-muted">Revenue</th>
                  <th className="text-right py-2 clr-muted">Growth</th>
                  <th className="text-right py-2 clr-muted">EBITDA</th>
                  <th className="text-right py-2 clr-muted">FCF</th>
                  <th className="text-right py-2 clr-muted">PV FCF</th>
                </tr>
              </thead>
              <tbody>
                {dcfOutput.projections.map(p => (
                  <tr key={p.year} className="row-b">
                    <td className="py-1.5 clr-text">Y{p.year}</td>
                    <td className="text-right py-1.5 clr-text">{formatMillions(p.revenue)}</td>
                    <td className="text-right py-1.5 clr-blue">{formatPercent(p.revenueGrowth)}</td>
                    <td className="text-right py-1.5 clr-text">{formatMillions(p.ebitda)}</td>
                    <td className="text-right py-1.5 clr-text">{formatMillions(p.freeCashFlow)}</td>
                    <td className="text-right py-1.5 clr-accent">{formatMillions(p.pvFCF)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleCard>

        {/* WACC Build-Up — closed by default */}
        <CollapsibleCard title="WACC Build-Up">
          <div className="flex flex-col">
            <AssumptionField label="Risk-Free Rate" assumption={waccA.risk_free_rate} format="percent" onOverride={v => onOverride('wacc.risk_free_rate', v)} min={BOUNDS.riskFreeRate.min} max={BOUNDS.riskFreeRate.max} correctionMessage={cx['wacc.risk_free_rate']} />
            <AssumptionField label="Equity Risk Premium" assumption={waccA.equity_risk_premium} format="percent" onOverride={v => onOverride('wacc.equity_risk_premium', v)} min={BOUNDS.equityRiskPremium.min} max={BOUNDS.equityRiskPremium.max} correctionMessage={cx['wacc.equity_risk_premium']} />
            <AssumptionField label="Beta" assumption={waccA.beta} format="number" onOverride={v => onOverride('wacc.beta', v)} min={BOUNDS.beta.min} max={BOUNDS.beta.max} correctionMessage={cx['wacc.beta']} rangeRule="beta" />
            <AssumptionField label="Size Premium" assumption={waccA.size_premium} format="percent" onOverride={v => onOverride('wacc.size_premium', v)} min={BOUNDS.sizePremium.min} max={BOUNDS.sizePremium.max} correctionMessage={cx['wacc.size_premium']} />
            <AssumptionField label="Cost of Debt" assumption={waccA.cost_of_debt} format="percent" onOverride={v => onOverride('wacc.cost_of_debt', v)} min={BOUNDS.costOfDebt.min} max={BOUNDS.costOfDebt.max} correctionMessage={cx['wacc.cost_of_debt']} />
            <AssumptionField label="Tax Rate" assumption={waccA.tax_rate} format="percent" onOverride={v => onOverride('wacc.tax_rate', v)} min={BOUNDS.taxRate.min} max={BOUNDS.taxRate.max} correctionMessage={cx['wacc.tax_rate']} />
            <AssumptionField label="Debt Weight" assumption={waccA.debt_weight} format="percent" onOverride={v => onOverride('wacc.debt_weight', v)} min={BOUNDS.debtWeight.min} max={BOUNDS.debtWeight.max} correctionMessage={cx['wacc.debt_weight']} />
            <AssumptionField label="Equity Weight" assumption={waccA.equity_weight} format="percent" onOverride={v => onOverride('wacc.equity_weight', v)} min={BOUNDS.equityWeight.min} max={BOUNDS.equityWeight.max} correctionMessage={cx['wacc.equity_weight']} />
          </div>
          <div className="mt-3 pt-3 flex justify-between row-t">
            <span className="font-mono text-xs font-semibold clr-text">WACC</span>
            <span className="font-mono text-sm font-bold clr-accent">{formatPercent(dcfOutput.wacc)}</span>
          </div>
        </CollapsibleCard>

        {/* DCF Assumptions — closed by default */}
        <CollapsibleCard title="DCF Assumptions">
          {/* Cash Flow Basis */}
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="font-mono text-xs assumption-label">Cash Flow Basis</span>
            <div className="flex gap-3">
              {[
                { value: CashFlowBasis.FCFF, label: 'FCFF (WACC)' },
                { value: CashFlowBasis.FCFE, label: 'FCFE (ke)' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-xs font-mono">
                  <input
                    type="radio"
                    name="cashFlowBasis"
                    checked={dcfConfig.cashFlowBasis === opt.value}
                    onChange={() => onDCFConfigChange({ cashFlowBasis: opt.value })}
                    className="accent-[#00FF88]"
                  />
                  <span className={dcfConfig.cashFlowBasis === opt.value ? 'clr-accent' : 'clr-muted'}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Discounting Convention */}
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="font-mono text-xs assumption-label">Discounting</span>
            <div className="flex gap-3">
              {[
                { value: DiscountingConvention.EndOfPeriod, label: 'End-of-Period' },
                { value: DiscountingConvention.MidPeriod, label: 'Mid-Year' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-xs font-mono">
                  <input
                    type="radio"
                    name="discounting"
                    checked={dcfConfig.discountingConvention === opt.value}
                    onChange={() => onDCFConfigChange({ discountingConvention: opt.value })}
                    className="accent-[#00FF88]"
                  />
                  <span className={dcfConfig.discountingConvention === opt.value ? 'clr-accent' : 'clr-muted'}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <AssumptionField label="EBITDA Margin" assumption={dcfA.ebitda_margin} format="percent" onOverride={v => onOverride('dcf.ebitda_margin', v)} min={BOUNDS.ebitdaMargin.min} max={BOUNDS.ebitdaMargin.max} correctionMessage={cx['dcf.ebitda_margin']} />
          <AssumptionField label="CapEx % Rev" assumption={dcfA.capex_pct_revenue} format="percent" onOverride={v => onOverride('dcf.capex_pct_revenue', v)} min={BOUNDS.capexPctRevenue.min} max={BOUNDS.capexPctRevenue.max} correctionMessage={cx['dcf.capex_pct_revenue']} />
          <AssumptionField label="NWC % Rev" assumption={dcfA.nwc_pct_revenue} format="percent" onOverride={v => onOverride('dcf.nwc_pct_revenue', v)} correctionMessage={cx['dcf.nwc_pct_revenue']} />
          <AssumptionField label="DCF Tax Rate" assumption={dcfA.tax_rate} format="percent" onOverride={v => onOverride('dcf.tax_rate', v)} min={BOUNDS.taxRate.min} max={BOUNDS.taxRate.max} correctionMessage={cx['dcf.tax_rate']} />
          <AssumptionField label="Terminal Growth" assumption={dcfA.terminal_growth_rate} format="percent" onOverride={v => onOverride('dcf.terminal_growth_rate', v)} min={BOUNDS.terminalGrowthRate.min} max={BOUNDS.terminalGrowthRate.max} correctionMessage={cx['dcf.terminal_growth_rate']} rangeRule="terminalGrowthRate" />
          <AssumptionField label="Exit Multiple" assumption={dcfA.exit_multiple} format="multiple" onOverride={v => onOverride('dcf.exit_multiple', v)} min={BOUNDS.exitMultiple.min} max={BOUNDS.exitMultiple.max} correctionMessage={cx['dcf.exit_multiple']} />
        </CollapsibleCard>

        {/* Model Inputs — closed by default */}
        <CollapsibleCard title="Model Inputs">
          <DataField label="Base Revenue (LTM)" value={financialData?.revenueLatest ?? null} originalValue={originalData?.revenueLatest ?? null} format="currency" onOverride={v => onDataOverride('revenueLatest', v)} />
          <DataField label="Shares Outstanding" value={financialData?.sharesOutstanding ?? null} originalValue={originalData?.sharesOutstanding ?? null} format="number" onOverride={v => onDataOverride('sharesOutstanding', v)} />
          <DataField label="Total Debt" value={financialData?.totalDebt ?? null} originalValue={originalData?.totalDebt ?? null} format="currency" onOverride={v => onDataOverride('totalDebt', v)} />
          <DataField label="Total Cash" value={financialData?.totalCash ?? null} originalValue={originalData?.totalCash ?? null} format="currency" onOverride={v => onDataOverride('totalCash', v)} />
          <DataField label="D&A (LTM)" value={financialData?.depreciationAndAmortization ?? null} originalValue={originalData?.depreciationAndAmortization ?? null} format="currency" onOverride={v => onDataOverride('depreciationAndAmortization', v)} />
        </CollapsibleCard>

        {/* Sensitivity Matrix — half width, beside Model Inputs, closed by default */}
        <CollapsibleCard title="Sensitivity Analysis (WACC vs Exit Multiple)">
          <div className="overflow-x-auto flex-1">
            <table className="w-full h-full text-xs font-mono">
              <thead>
                <tr className="row-b">
                  <th className="py-2 text-left clr-muted">WACC \ Exit</th>
                  {dcfOutput.sensitivityTerminalRange.map(t => (
                    <th key={t} className="py-2 text-right clr-muted">{t.toFixed(1)}x</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dcfOutput.sensitivityMatrix.map((row, i) => (
                  <tr key={i} className={`row-b${i === 2 ? ' sensitivity-mid-row' : ''}`}>
                    <td className="py-1.5 clr-muted">
                      {formatPercent(dcfOutput.sensitivityWACCRange[i])}
                    </td>
                    {row.map((price, j) => (
                      <td
                        key={j}
                        className={`text-right py-1.5${i === 2 && j === 2 ? ' sensitivity-mid-cell' : ' clr-text'}`}
                      >
                        {formatCurrency(price, 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleCard>
      </div>
    </div>
  )
}
