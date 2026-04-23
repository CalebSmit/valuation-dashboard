export interface DDMApplicabilityCriterion {
  name: string
  pass: boolean
  detail: string
}

export interface DPSProjection {
  year: number
  dps: number
  growthRate: number
  pvDPS: number
}

export interface DDMOutput {
  isApplicable: boolean
  applicabilityCriteria: DDMApplicabilityCriterion[]
  applicabilityScore: number
  singleStagePrice: number | null
  twoStagePrice: number | null
  impliedPrice: number | null
  currentDPS: number | null
  requiredReturn: number | null
  shortTermGrowth: number | null
  longTermGrowth: number | null
  dpsProjections: DPSProjection[]
}
