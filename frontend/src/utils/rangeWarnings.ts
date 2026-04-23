/**
 * Out-of-range warnings for assumption inputs.
 * These do NOT change the value — they flag it for user review when it is
 * technically valid (within hard BOUNDS) but outside the typical analyst range.
 */

export interface RangeWarning {
  message: string
}

interface RangeRule {
  check: (value: number) => boolean
  message: string
}

const RULES: Record<string, RangeRule> = {
  wacc: {
    check: v => v < 0.06 || v > 0.16,
    message: 'Outside typical range (6–16%)',
  },
  terminalGrowthRate: {
    check: v => v > 0.035,
    message: 'Above typical terminal growth cap (3.5%)',
  },
  ddmPayoutRatio: {
    check: v => v < 0.20 || v > 0.80,
    message: 'Outside typical range (20–80%)',
  },
  beta: {
    check: v => v < 0.3 || v > 3.0,
    message: 'Outside typical range (0.3–3.0)',
  },
}

export function getRangeWarning(rule: string | undefined, value: number): RangeWarning | null {
  if (!rule) return null
  const r = RULES[rule]
  if (!r) return null
  return r.check(value) ? { message: r.message } : null
}
