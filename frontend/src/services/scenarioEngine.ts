/**
 * Scenario analysis engine — meta-engine that calls DCF/DDM/Comps
 * with Bear/Base/Bull adjusted assumptions.
 */
import type { FinancialData } from '../types/FinancialData.ts'
import type { Assumptions, SourcedAssumption } from '../types/Assumptions.ts'
import type { ScenarioOutput, ScenarioCase, ScenarioDriver } from '../types/ScenarioOutput.ts'
import type { ValuationConfig } from '../types/ValuationConfig.ts'
import { BACKWARD_COMPAT_CONFIG } from '../types/ValuationConfig.ts'
import { computeDCF } from './dcfEngine.ts'
import { computeDDM } from './ddmEngine.ts'
import { computeComps } from './compsEngine.ts'
import { computeBlendedPriceTarget } from './blendingEngine.ts'
import { DEFAULT_SCENARIO_PROBABILITIES } from '../utils/constants.ts'

type ScenarioName = 'bear' | 'base' | 'bull'

function applyScenarioAdjustments(
  base: Assumptions,
  scenarioName: ScenarioName,
): Assumptions {
  const { scenarios } = base
  const getVal = (drivers: { bear: SourcedAssumption; base: SourcedAssumption; bull: SourcedAssumption }) =>
    drivers[scenarioName].value

  // Clone assumptions and override with scenario-specific values
  const adjustedGrowthRates = base.dcf.revenue_growth_rates.map(r => ({
    ...r,
    value: r.value + (getVal(scenarios.revenue_growth) - scenarios.revenue_growth.base.value),
  }))

  return {
    ...base,
    dcf: {
      ...base.dcf,
      revenue_growth_rates: adjustedGrowthRates,
      ebitda_margin: {
        ...base.dcf.ebitda_margin,
        value: getVal(scenarios.ebitda_margin),
      },
      exit_multiple: {
        ...base.dcf.exit_multiple,
        value: getVal(scenarios.exit_multiple),
      },
    },
    wacc: {
      ...base.wacc,
      // Adjust risk-free rate to shift WACC directly (not ERP which gets beta-multiplied)
      risk_free_rate: {
        ...base.wacc.risk_free_rate,
        value: base.wacc.risk_free_rate.value +
          (getVal(scenarios.wacc) - scenarios.wacc.base.value),
      },
    },
  }
}

export function buildScenarios(
  data: FinancialData,
  baseAssumptions: Assumptions,
  config?: ValuationConfig,
): ScenarioOutput {
  const { scenarios } = baseAssumptions
  const probabilityWeights = scenarios.probabilities ?? DEFAULT_SCENARIO_PROBABILITIES

  // Build scenario driver table
  const drivers: ScenarioDriver[] = [
    {
      assumption: 'Revenue Growth',
      bearValue: scenarios.revenue_growth.bear.value,
      baseValue: scenarios.revenue_growth.base.value,
      bullValue: scenarios.revenue_growth.bull.value,
      bearSource: scenarios.revenue_growth.bear.source,
      baseSource: scenarios.revenue_growth.base.source,
      bullSource: scenarios.revenue_growth.bull.source,
    },
    {
      assumption: 'EBITDA Margin',
      bearValue: scenarios.ebitda_margin.bear.value,
      baseValue: scenarios.ebitda_margin.base.value,
      bullValue: scenarios.ebitda_margin.bull.value,
      bearSource: scenarios.ebitda_margin.bear.source,
      baseSource: scenarios.ebitda_margin.base.source,
      bullSource: scenarios.ebitda_margin.bull.source,
    },
    {
      assumption: 'Exit Multiple',
      bearValue: scenarios.exit_multiple.bear.value,
      baseValue: scenarios.exit_multiple.base.value,
      bullValue: scenarios.exit_multiple.bull.value,
      bearSource: scenarios.exit_multiple.bear.source,
      baseSource: scenarios.exit_multiple.base.source,
      bullSource: scenarios.exit_multiple.bull.source,
    },
    {
      assumption: 'WACC Adjustment',
      bearValue: scenarios.wacc.bear.value,
      baseValue: scenarios.wacc.base.value,
      bullValue: scenarios.wacc.bull.value,
      bearSource: scenarios.wacc.bear.source,
      baseSource: scenarios.wacc.base.source,
      bullSource: scenarios.wacc.bull.source,
    },
  ]

  const effectiveConfig = config ?? BACKWARD_COMPAT_CONFIG

  function buildCase(name: ScenarioName): ScenarioCase {
    const adjusted = applyScenarioAdjustments(baseAssumptions, name)
    const dcfResult = computeDCF(data, adjusted, effectiveConfig.dcfConfig)
    const ddmResult = computeDDM(data, adjusted.ddm, adjusted.wacc)
    const compsResult = computeComps(data, data.competitors, adjusted.comps)

    const blend = computeBlendedPriceTarget(dcfResult, ddmResult, compsResult, effectiveConfig)

    return {
      name,
      drivers,
      dcfPrice: dcfResult.impliedPrice,
      ddmPrice: ddmResult.impliedPrice,
      compsPrice: compsResult.weightedImpliedPrice,
      weightedPrice: blend.finalPrice,
    }
  }

  const bear = buildCase('bear')
  const base = buildCase('base')
  const bull = buildCase('bull')

  const expectedPrice = [
    { price: bear.weightedPrice, probability: probabilityWeights.bear },
    { price: base.weightedPrice, probability: probabilityWeights.base },
    { price: bull.weightedPrice, probability: probabilityWeights.bull },
  ].reduce<number | null>((sum, current) => {
    if (current.price === null) {
      return sum
    }
    return (sum ?? 0) + current.price * current.probability
  }, null)

  return {
    bear,
    base,
    bull,
    drivers,
    expectedPrice,
    probabilityWeights,
  }
}

