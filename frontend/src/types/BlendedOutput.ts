export interface BlendedPriceTarget {
  finalPrice: number | null

  dcfBlendedPrice: number | null
  dcfExitOnlyPrice: number | null
  dcfGordonOnlyPrice: number | null
  combinedDCFPrice: number | null

  compsPrice: number | null
  ddmPrice: number | null

  effectiveDCFSubWeights: { blended: number; exitOnly: number; gordonOnly: number }
  effectiveDDMSubWeights: { twoStage: number; singleStage: number }
  effectiveModelWeights: { dcf: number; comps: number; ddm: number }
}
