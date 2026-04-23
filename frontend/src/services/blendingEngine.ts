/**
 * Blending engine — computes the final weighted price target from DCF/DDM/Comps outputs.
 * Three-tier blending: DCF sub-weights, DDM sub-weights, then overall model weights.
 * Pure functions — no side effects, fully testable.
 */
import type { DCFOutput } from '../types/DCFOutput.ts'
import type { DDMOutput } from '../types/DDMOutput.ts'
import type { CompsOutput } from '../types/CompsOutput.ts'
import type { BlendedPriceTarget } from '../types/BlendedOutput.ts'
import type { ValuationConfig, DCFSubWeights, DDMSubWeights, ModelWeights } from '../types/ValuationConfig.ts'

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const clamped = Object.fromEntries(
    Object.entries(weights).map(([k, v]) => [k, Math.max(0, v)])
  )
  const total = Object.values(clamped).reduce((s, v) => s + v, 0)
  if (total === 0) {
    const n = Object.keys(clamped).length
    return Object.fromEntries(Object.keys(clamped).map(k => [k, 1 / n]))
  }
  return Object.fromEntries(
    Object.entries(clamped).map(([k, v]) => [k, v / total])
  )
}

export function adjustWeights(
  current: Record<string, number>,
  changedKey: string,
  newValue: number,
): Record<string, number> {
  const clamped = Math.max(0, Math.min(1, newValue))
  const remaining = 1 - clamped
  const otherKeys = Object.keys(current).filter(k => k !== changedKey)
  const otherSum = otherKeys.reduce((s, k) => s + current[k], 0)

  const result: Record<string, number> = { [changedKey]: clamped }
  for (const key of otherKeys) {
    result[key] = otherSum > 0
      ? (current[key] / otherSum) * remaining
      : remaining / otherKeys.length
  }
  return result
}

export function computeBlendedPriceTarget(
  dcfOutput: DCFOutput | null,
  ddmOutput: DDMOutput | null,
  compsOutput: CompsOutput | null,
  config: ValuationConfig,
): BlendedPriceTarget {
  // --- DCF sub-blending ---
  const dcfBlendedPrice = dcfOutput?.impliedPrice ?? null
  const dcfExitOnlyPrice = dcfOutput?.impliedPriceExitMultiple ?? null
  const dcfGordonOnlyPrice = dcfOutput?.impliedPriceGordon ?? null

  const dcfPrices: Record<string, number | null> = {
    blended: dcfBlendedPrice,
    exitOnly: dcfExitOnlyPrice,
    gordonOnly: dcfGordonOnlyPrice,
  }

  const availableDCF = Object.entries(dcfPrices)
    .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)

  let combinedDCFPrice: number | null = null
  let effectiveDCFSubWeights = { blended: 0, exitOnly: 0, gordonOnly: 0 }

  if (availableDCF.length > 0) {
    const rawWeights: Record<string, number> = {}
    for (const [key] of availableDCF) {
      rawWeights[key] = config.dcfSubWeights[key as keyof DCFSubWeights]
    }
    const normalized = normalizeWeights(rawWeights)
    combinedDCFPrice = availableDCF.reduce(
      (sum, [key, price]) => sum + price * (normalized[key] ?? 0), 0,
    )
    effectiveDCFSubWeights = {
      blended: normalized.blended ?? 0,
      exitOnly: normalized.exitOnly ?? 0,
      gordonOnly: normalized.gordonOnly ?? 0,
    }
  }

  // --- DDM sub-blending (two-stage vs single-stage) ---
  // No applicability gate — if the engine produced a price, include it.
  // Non-dividend payers naturally have null prices and get excluded.
  const ddmTwoStagePrice = ddmOutput?.twoStagePrice ?? null
  const ddmSingleStagePrice = ddmOutput?.singleStagePrice ?? null

  const ddmPrices: Record<string, number | null> = {
    twoStage: ddmTwoStagePrice,
    singleStage: ddmSingleStagePrice,
  }

  const availableDDM = Object.entries(ddmPrices)
    .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)

  let ddmPrice: number | null = null
  let effectiveDDMSubWeights = { twoStage: 0, singleStage: 0 }

  if (availableDDM.length > 0) {
    const rawWeights: Record<string, number> = {}
    for (const [key] of availableDDM) {
      rawWeights[key] = config.ddmSubWeights[key as keyof DDMSubWeights]
    }
    const normalized = normalizeWeights(rawWeights)
    ddmPrice = availableDDM.reduce(
      (sum, [key, price]) => sum + price * (normalized[key] ?? 0), 0,
    )
    effectiveDDMSubWeights = {
      twoStage: normalized.twoStage ?? 0,
      singleStage: normalized.singleStage ?? 0,
    }
  }

  // --- Comps sub-weight blending ---
  // Map compsSubWeights keys to the multiple name strings used in impliedPrices
  const compsKeyToMultiple: Record<string, string> = {
    evEbitda: 'EV/EBITDA',
    pe: 'P/E',
    evSales: 'EV/Sales',
    pb: 'P/B',
  }

  let compsPrice: number | null = null
  if (compsOutput) {
    const available = Object.entries(compsKeyToMultiple)
      .map(([key, multipleName]) => {
        const match = compsOutput.impliedPrices.find(
          ip => ip.multiple === multipleName && ip.isApplicable && ip.impliedPrice !== null,
        )
        return match ? { key, price: match.impliedPrice as number } : null
      })
      .filter((x): x is { key: string; price: number } => x !== null)

    if (available.length > 0) {
      const rawWeights: Record<string, number> = {}
      for (const { key } of available) {
        rawWeights[key] = config.compsSubWeights[key as keyof typeof config.compsSubWeights]
      }
      const normalized = normalizeWeights(rawWeights)
      const totalNorm = Object.values(normalized).reduce((s, w) => s + w, 0)
      compsPrice = totalNorm > 0
        ? available.reduce((sum, { key, price }) => sum + price * (normalized[key] ?? 0), 0)
        : compsOutput.weightedImpliedPrice
    } else {
      compsPrice = compsOutput.weightedImpliedPrice
    }
  }

  // --- Model-level blending ---
  const modelPrices: Record<string, number | null> = {
    dcf: combinedDCFPrice,
    comps: compsPrice,
    ddm: ddmPrice,
  }

  const availableModels = Object.entries(modelPrices)
    .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)

  let finalPrice: number | null = null
  let effectiveModelWeights = { dcf: 0, comps: 0, ddm: 0 }

  if (availableModels.length > 0) {
    const rawWeights: Record<string, number> = {}
    for (const [key] of availableModels) {
      rawWeights[key] = config.modelWeights[key as keyof ModelWeights]
    }
    const normalized = normalizeWeights(rawWeights)
    finalPrice = availableModels.reduce(
      (sum, [key, price]) => sum + price * (normalized[key] ?? 0), 0,
    )
    effectiveModelWeights = {
      dcf: normalized.dcf ?? 0,
      comps: normalized.comps ?? 0,
      ddm: normalized.ddm ?? 0,
    }
  }

  return {
    finalPrice,
    dcfBlendedPrice,
    dcfExitOnlyPrice,
    dcfGordonOnlyPrice,
    combinedDCFPrice,
    compsPrice,
    ddmPrice,
    effectiveDCFSubWeights,
    effectiveDDMSubWeights,
    effectiveModelWeights,
  }
}
