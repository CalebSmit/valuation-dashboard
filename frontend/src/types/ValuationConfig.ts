// Using const objects + string literal types instead of enums to comply with
// `erasableSyntaxOnly: true` (TypeScript 5.5+ strict mode).

export const TerminalValueMethod = {
  Blended: 'blended',
  ExitMultipleOnly: 'exit',
  GordonGrowthOnly: 'gordon',
} as const
export type TerminalValueMethod = typeof TerminalValueMethod[keyof typeof TerminalValueMethod]

export const CashFlowBasis = {
  FCFF: 'fcff',
  FCFE: 'fcfe',
} as const
export type CashFlowBasis = typeof CashFlowBasis[keyof typeof CashFlowBasis]

export const DiscountingConvention = {
  EndOfPeriod: 'end',
  MidPeriod: 'mid',
} as const
export type DiscountingConvention = typeof DiscountingConvention[keyof typeof DiscountingConvention]

export interface DCFConfig {
  terminalValueMethod: TerminalValueMethod
  cashFlowBasis: CashFlowBasis
  discountingConvention: DiscountingConvention
}

export interface DCFSubWeights {
  blended: number
  exitOnly: number
  gordonOnly: number
}

export interface CompsSubWeights {
  evEbitda: number
  pe: number
  evSales: number
  pb: number
}

export interface DDMSubWeights {
  twoStage: number
  singleStage: number
}

export interface ModelWeights {
  dcf: number
  comps: number
  ddm: number
}

export interface ValuationConfig {
  dcfConfig: DCFConfig
  dcfSubWeights: DCFSubWeights
  compsSubWeights: CompsSubWeights
  ddmSubWeights: DDMSubWeights
  modelWeights: ModelWeights
}

export interface AIRecommendedConfig {
  dcfConfig: DCFConfig
  dcfSubWeights: DCFSubWeights
  modelWeights: ModelWeights
  rationale: string
}

export const DEFAULT_DCF_CONFIG: DCFConfig = {
  terminalValueMethod: TerminalValueMethod.Blended,
  cashFlowBasis: CashFlowBasis.FCFF,
  discountingConvention: DiscountingConvention.EndOfPeriod,
}

export const DEFAULT_DCF_SUB_WEIGHTS: DCFSubWeights = {
  blended: 1.0,
  exitOnly: 0.0,
  gordonOnly: 0.0,
}

export const DEFAULT_COMPS_SUB_WEIGHTS: CompsSubWeights = {
  evEbitda: 0.40,
  pe: 0.30,
  evSales: 0.20,
  pb: 0.10,
}

export const DEFAULT_DDM_SUB_WEIGHTS: DDMSubWeights = {
  twoStage: 0.70,
  singleStage: 0.30,
}

export const DEFAULT_MODEL_WEIGHTS: ModelWeights = {
  dcf: 0.50,
  comps: 0.30,
  ddm: 0.20,
}

export const DEFAULT_VALUATION_CONFIG: ValuationConfig = {
  dcfConfig: DEFAULT_DCF_CONFIG,
  dcfSubWeights: DEFAULT_DCF_SUB_WEIGHTS,
  compsSubWeights: DEFAULT_COMPS_SUB_WEIGHTS,
  ddmSubWeights: DEFAULT_DDM_SUB_WEIGHTS,
  modelWeights: DEFAULT_MODEL_WEIGHTS,
}

export const BACKWARD_COMPAT_CONFIG: ValuationConfig = {
  dcfConfig: DEFAULT_DCF_CONFIG,
  dcfSubWeights: { blended: 1.0, exitOnly: 0.0, gordonOnly: 0.0 },
  compsSubWeights: DEFAULT_COMPS_SUB_WEIGHTS,
  ddmSubWeights: DEFAULT_DDM_SUB_WEIGHTS,
  modelWeights: { dcf: 1 / 3, comps: 1 / 3, ddm: 1 / 3 },
}
