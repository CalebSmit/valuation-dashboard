/**
 * Validates and corrects Claude's assumption output before it reaches the engines.
 * Catches: percentage/decimal mismatches, weight normalization, bound violations.
 */
import type { Assumptions, SourcedAssumption } from '../types/Assumptions.ts'
import {
  DEFAULT_COMPS_WEIGHTS,
  DEFAULT_SCENARIO_PROBABILITIES,
  PROJECTION_YEARS,
} from '../utils/constants.ts'

interface ValidationResult {
  valid: boolean
  warnings: string[]
  corrected: Assumptions
}

function normalizeRate(sa: SourcedAssumption, fieldName: string, warnings: string[]): SourcedAssumption {
  if (Math.abs(sa.value) > 1.0 && fieldName !== 'exit_multiple') {
    const corrected = sa.value / 100
    warnings.push(`${fieldName}: ${sa.value} looks like a percentage, corrected to ${corrected.toFixed(4)}`)
    return { ...sa, value: corrected }
  }
  return sa
}

function clampRate(sa: SourcedAssumption, fieldName: string, min: number, max: number, warnings: string[]): SourcedAssumption {
  if (sa.value < min) {
    warnings.push(`${fieldName}: ${sa.value} below minimum ${min}, clamped`)
    return { ...sa, value: min }
  }
  if (sa.value > max) {
    warnings.push(`${fieldName}: ${sa.value} above maximum ${max}, clamped`)
    return { ...sa, value: max }
  }
  return sa
}

function normalizeWeightMap<T extends Record<string, number>>(
  raw: Partial<T> | undefined,
  defaults: T,
  warnings: string[],
  label: string,
  min?: number,
  max?: number,
): T {
  const normalizedEntries: Array<[string, number]> = Object.entries(defaults).map(([key, defaultValue]) => {
    const currentValue = raw?.[key as keyof T]
    let nextValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
      ? currentValue
      : defaultValue

    if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
      warnings.push(`${label}.${key} missing, defaulted to ${defaultValue.toFixed(2)}`)
    }

    if (min !== undefined && nextValue < min) {
      warnings.push(`${label}.${key} below minimum ${min.toFixed(2)}, clamped`)
      nextValue = min
    }
    if (max !== undefined && nextValue > max) {
      warnings.push(`${label}.${key} above maximum ${max.toFixed(2)}, clamped`)
      nextValue = max
    }

    return [key, nextValue]
  })

  const sum = normalizedEntries.reduce((total, [, value]) => total + value, 0)
  if (!Number.isFinite(sum) || sum <= 0) {
    warnings.push(`${label} invalid, reset to defaults`)
    return { ...defaults }
  }

  if (Math.abs(sum - 1) > 0.01) {
    warnings.push(`${label} sum to ${sum.toFixed(2)}, normalized to 1.00`)
  }

  return Object.fromEntries(
    normalizedEntries.map(([key, value]) => [key, value / sum]),
  ) as T
}

export function validateAssumptions(raw: Assumptions): ValidationResult {
  const warnings: string[] = []
  const c = JSON.parse(JSON.stringify(raw)) as Assumptions

  // 1. WACC rates: normalize percentage-form values
  c.wacc.risk_free_rate = normalizeRate(c.wacc.risk_free_rate, 'risk_free_rate', warnings)
  c.wacc.equity_risk_premium = normalizeRate(c.wacc.equity_risk_premium, 'equity_risk_premium', warnings)
  c.wacc.cost_of_debt = normalizeRate(c.wacc.cost_of_debt, 'cost_of_debt', warnings)
  c.wacc.size_premium = normalizeRate(c.wacc.size_premium, 'size_premium', warnings)
  c.wacc.tax_rate = normalizeRate(c.wacc.tax_rate, 'tax_rate', warnings)
  c.wacc.debt_weight = normalizeRate(c.wacc.debt_weight, 'debt_weight', warnings)
  c.wacc.equity_weight = normalizeRate(c.wacc.equity_weight, 'equity_weight', warnings)

  // 2. Capital weights must sum to ~1.0
  const weightSum = c.wacc.debt_weight.value + c.wacc.equity_weight.value
  if (Math.abs(weightSum - 1.0) > 0.02) {
    warnings.push(`Capital weights sum to ${weightSum.toFixed(3)}, normalizing to 1.0`)
    c.wacc.equity_weight = { ...c.wacc.equity_weight, value: c.wacc.equity_weight.value / weightSum }
    c.wacc.debt_weight = { ...c.wacc.debt_weight, value: c.wacc.debt_weight.value / weightSum }
  }

  // 3. WACC sanity: risk-free rate should be 0-15%
  c.wacc.risk_free_rate = clampRate(c.wacc.risk_free_rate, 'risk_free_rate', 0, 0.15, warnings)
  c.wacc.equity_risk_premium = clampRate(c.wacc.equity_risk_premium, 'equity_risk_premium', 0.02, 0.12, warnings)
  c.wacc.beta = clampRate(c.wacc.beta, 'beta', -1, 5, warnings)

  // 4. DCF rates: normalize and bound
  c.dcf.ebitda_margin = normalizeRate(c.dcf.ebitda_margin, 'ebitda_margin', warnings)
  c.dcf.capex_pct_revenue = normalizeRate(c.dcf.capex_pct_revenue, 'capex_pct_revenue', warnings)
  c.dcf.nwc_pct_revenue = normalizeRate(c.dcf.nwc_pct_revenue, 'nwc_pct_revenue', warnings)
  c.dcf.tax_rate = normalizeRate(c.dcf.tax_rate, 'dcf_tax_rate', warnings)
  c.dcf.terminal_growth_rate = normalizeRate(c.dcf.terminal_growth_rate, 'terminal_growth_rate', warnings)
  c.dcf.terminal_growth_rate = clampRate(c.dcf.terminal_growth_rate, 'terminal_growth_rate', 0, 0.05, warnings)
  c.dcf.mid_year_convention = Boolean(c.dcf.mid_year_convention)

  // 5. Revenue growth rates: normalize and ensure PROJECTION_YEARS entries
  c.dcf.revenue_growth_rates = c.dcf.revenue_growth_rates.map((r, i) =>
    normalizeRate(r, `revenue_growth_rate_y${i + 1}`, warnings)
  )
  while (c.dcf.revenue_growth_rates.length < PROJECTION_YEARS) {
    const lastRate = c.dcf.revenue_growth_rates[c.dcf.revenue_growth_rates.length - 1]
    c.dcf.revenue_growth_rates.push(lastRate ? { ...lastRate } : {
      value: 0.03, source: 'Default fallback', confidence: 'low', rationale: 'Padded to 5 years',
    })
    warnings.push(`Padded revenue_growth_rates to ${c.dcf.revenue_growth_rates.length} years`)
  }

  // 6. Terminal growth must be < estimated WACC
  const estimatedKe = c.wacc.risk_free_rate.value + c.wacc.beta.value * c.wacc.equity_risk_premium.value
  const estimatedWACC = c.wacc.equity_weight.value * estimatedKe +
    c.wacc.debt_weight.value * c.wacc.cost_of_debt.value * (1 - c.wacc.tax_rate.value)
  if (c.dcf.terminal_growth_rate.value >= estimatedWACC) {
    const fixed = estimatedWACC * 0.4
    warnings.push(`Terminal growth (${(c.dcf.terminal_growth_rate.value * 100).toFixed(1)}%) >= WACC (${(estimatedWACC * 100).toFixed(1)}%), reduced to ${(fixed * 100).toFixed(1)}%`)
    c.dcf.terminal_growth_rate = { ...c.dcf.terminal_growth_rate, value: fixed }
  }

  // 7. Exit multiple bounds
  c.dcf.exit_multiple = clampRate(c.dcf.exit_multiple, 'exit_multiple', 2, 40, warnings)

  // 8. DDM rates if applicable
  if (c.ddm.is_applicable) {
    if (c.ddm.short_term_growth_rate) {
      c.ddm.short_term_growth_rate = normalizeRate(c.ddm.short_term_growth_rate, 'ddm_short_term_growth', warnings)
    }
    if (c.ddm.long_term_growth_rate) {
      c.ddm.long_term_growth_rate = normalizeRate(c.ddm.long_term_growth_rate, 'ddm_long_term_growth', warnings)
    }
    if (c.ddm.required_return) {
      c.ddm.required_return = normalizeRate(c.ddm.required_return, 'ddm_required_return', warnings)
    }
  }

  c.comps.multiple_weights = normalizeWeightMap(
    c.comps.multiple_weights,
    DEFAULT_COMPS_WEIGHTS,
    warnings,
    'comps.multiple_weights',
  )

  c.scenarios.probabilities = normalizeWeightMap(
    c.scenarios.probabilities,
    DEFAULT_SCENARIO_PROBABILITIES,
    warnings,
    'scenarios.probabilities',
    0.05,
    0.80,
  )

  // 9. Scenario drivers: normalize
  for (const driverKey of ['revenue_growth', 'ebitda_margin', 'wacc'] as const) {
    const drivers = c.scenarios[driverKey]
    drivers.bear = normalizeRate(drivers.bear, `scenario_${driverKey}_bear`, warnings)
    drivers.base = normalizeRate(drivers.base, `scenario_${driverKey}_base`, warnings)
    drivers.bull = normalizeRate(drivers.bull, `scenario_${driverKey}_bull`, warnings)
  }

  return {
    valid: warnings.length === 0,
    warnings,
    corrected: c,
  }
}
