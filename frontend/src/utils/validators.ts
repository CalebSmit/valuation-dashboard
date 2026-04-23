/**
 * Input validation for tickers, assumptions, and financial bounds.
 */
import { BOUNDS } from './constants.ts'

export function validateTicker(ticker: string): { valid: boolean; error: string } {
  const cleaned = ticker.trim().toUpperCase()
  if (!cleaned) {
    return { valid: false, error: 'Ticker is required' }
  }
  if (cleaned.length > 10) {
    return { valid: false, error: 'Ticker must be 1-10 characters' }
  }
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(cleaned)) {
    return { valid: false, error: 'Ticker must start with a letter and may include digits, dots, or hyphens' }
  }
  return { valid: true, error: '' }
}

export interface BoundsCheck {
  field: string
  value: number
  min: number
  max: number
  valid: boolean
  error: string
}

export function validateAssumptionBounds(
  field: string,
  value: number,
): BoundsCheck {
  const boundsKey = field as keyof typeof BOUNDS
  const bounds = BOUNDS[boundsKey]

  if (!bounds) {
    return { field, value, min: -Infinity, max: Infinity, valid: true, error: '' }
  }

  if (value < bounds.min || value > bounds.max) {
    return {
      field,
      value,
      min: bounds.min,
      max: bounds.max,
      valid: false,
      error: `${field} must be between ${bounds.min} and ${bounds.max}`,
    }
  }

  return { field, value, min: bounds.min, max: bounds.max, valid: true, error: '' }
}

export function validateWACC(wacc: number, terminalGrowthRate: number): {
  valid: boolean
  error: string
} {
  if (terminalGrowthRate >= wacc) {
    return {
      valid: false,
      error: `Terminal growth rate (${(terminalGrowthRate * 100).toFixed(2)}%) must be less than WACC (${(wacc * 100).toFixed(2)}%)`,
    }
  }
  if (wacc <= 0) {
    return { valid: false, error: 'WACC must be positive' }
  }
  if (wacc > 0.30) {
    return { valid: false, error: 'WACC exceeds 30% — check assumptions' }
  }
  return { valid: true, error: '' }
}
