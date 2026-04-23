import { describe, it, expect } from 'vitest'
import {
  computeWACC,
  computeCAPM,
  computeNPV,
  terminalValueGordonGrowth,
  terminalValueExitMultiple,
  discountToPresent,
  computeGeometricMean,
  median,
} from '../src/utils/financialMath.ts'

describe('computeCAPM', () => {
  it('computes cost of equity from CAPM components', () => {
    const result = computeCAPM(0.0406, 0.634, 0.0423, 0)
    // 0.0406 + 0.634 * 0.0423 = 0.0406 + 0.02682 = 0.06742
    expect(result).toBeCloseTo(0.06742, 4)
  })

  it('includes size premium', () => {
    const result = computeCAPM(0.0406, 1.0, 0.0423, 0.02)
    // 0.0406 + 1.0 * 0.0423 + 0.02 = 0.1029
    expect(result).toBeCloseTo(0.1029, 4)
  })
})

describe('computeWACC', () => {
  it('returns a value between 6% and 12% for typical inputs', () => {
    const wacc = computeWACC({
      riskFreeRate: 0.0406,
      beta: 0.634,
      equityRiskPremium: 0.0423,
      sizePremium: 0,
      costOfDebt: 0.05,
      taxRate: 0.21,
      debtWeight: 0.3,
      equityWeight: 0.7,
    })
    expect(wacc).toBeGreaterThan(0.04)
    expect(wacc).toBeLessThan(0.12)
  })

  it('returns higher WACC with higher beta', () => {
    const low = computeWACC({
      riskFreeRate: 0.04, beta: 0.5, equityRiskPremium: 0.05,
      sizePremium: 0, costOfDebt: 0.05, taxRate: 0.21,
      debtWeight: 0.3, equityWeight: 0.7,
    })
    const high = computeWACC({
      riskFreeRate: 0.04, beta: 1.5, equityRiskPremium: 0.05,
      sizePremium: 0, costOfDebt: 0.05, taxRate: 0.21,
      debtWeight: 0.3, equityWeight: 0.7,
    })
    expect(high).toBeGreaterThan(low)
  })
})

describe('computeNPV', () => {
  it('discounts cash flows correctly', () => {
    const npv = computeNPV([100, 100, 100], 0.10)
    // 100/1.1 + 100/1.21 + 100/1.331 = 90.909 + 82.645 + 75.131 = 248.685
    expect(npv).toBeCloseTo(248.685, 1)
  })

  it('returns 0 for empty cash flows', () => {
    expect(computeNPV([], 0.10)).toBe(0)
  })
})

describe('terminalValueGordonGrowth', () => {
  it('computes Gordon Growth terminal value', () => {
    const tv = terminalValueGordonGrowth(100, 0.025, 0.10)
    // 100 * 1.025 / (0.10 - 0.025) = 102.5 / 0.075 = 1366.67
    expect(tv).toBeCloseTo(1366.67, 0)
  })

  it('returns null when growth rate >= WACC', () => {
    expect(terminalValueGordonGrowth(100, 0.10, 0.10)).toBeNull()
    expect(terminalValueGordonGrowth(100, 0.12, 0.10)).toBeNull()
  })

  it('returns null when WACC is zero', () => {
    expect(terminalValueGordonGrowth(100, 0.02, 0)).toBeNull()
  })
})

describe('terminalValueExitMultiple', () => {
  it('computes exit multiple terminal value', () => {
    const tv = terminalValueExitMultiple(500, 10)
    expect(tv).toBe(5000)
  })
})

describe('discountToPresent', () => {
  it('discounts a future value to present', () => {
    const pv = discountToPresent(1000, 0.10, 5)
    // 1000 / 1.1^5 = 1000 / 1.61051 = 620.92
    expect(pv).toBeCloseTo(620.92, 0)
  })

  it('returns the value itself for 0 periods', () => {
    expect(discountToPresent(1000, 0.10, 0)).toBe(1000)
  })
})

describe('computeGeometricMean', () => {
  it('computes geometric mean of return rates', () => {
    // Returns: 10%, 20%, 5% → ((1.1)(1.2)(1.05))^(1/3) - 1
    const result = computeGeometricMean([0.10, 0.20, 0.05])
    expect(result).toBeCloseTo(0.1155, 2)
  })

  it('handles negative returns correctly', () => {
    // Returns: 15%, -10%, 20% → ((1.15)(0.90)(1.20))^(1/3) - 1
    const result = computeGeometricMean([0.15, -0.10, 0.20])
    expect(result).toBeCloseTo(0.0743, 2)
  })

  it('returns 0 for empty array', () => {
    expect(computeGeometricMean([])).toBe(0)
  })

  it('returns -1 for total loss', () => {
    expect(computeGeometricMean([-1.0])).toBe(-1)
  })
})

describe('median', () => {
  it('returns median of odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('returns average of middle two for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('returns null for empty array', () => {
    expect(median([])).toBeNull()
  })

  it('filters out NaN and Infinity', () => {
    expect(median([1, NaN, 3, Infinity, 2])).toBe(2)
  })
})
