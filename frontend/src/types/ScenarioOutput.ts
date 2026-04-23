export interface ScenarioCase {
  name: 'bear' | 'base' | 'bull'
  drivers: ScenarioDriver[]
  dcfPrice: number | null
  ddmPrice: number | null
  compsPrice: number | null
  weightedPrice: number | null
}

export interface ScenarioDriver {
  assumption: string
  bearValue: number
  baseValue: number
  bullValue: number
  bearSource: string
  baseSource: string
  bullSource: string
}

export interface ScenarioOutput {
  bear: ScenarioCase
  base: ScenarioCase
  bull: ScenarioCase
  drivers: ScenarioDriver[]
  expectedPrice: number | null
  probabilityWeights: {
    bear: number
    base: number
    bull: number
  }
}
