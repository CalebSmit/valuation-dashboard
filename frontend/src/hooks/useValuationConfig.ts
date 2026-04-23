import { useState, useEffect, useCallback } from 'react'
import type { DCFConfig, DCFSubWeights, CompsSubWeights, DDMSubWeights, ModelWeights, ValuationConfig, AIRecommendedConfig } from '../types/ValuationConfig.ts'
import { DEFAULT_VALUATION_CONFIG } from '../types/ValuationConfig.ts'
import { adjustWeights } from '../services/blendingEngine.ts'

export function useValuationConfig(aiRecommended: AIRecommendedConfig | null) {
  const [config, setConfig] = useState<ValuationConfig>(DEFAULT_VALUATION_CONFIG)
  const [isAIDefault, setIsAIDefault] = useState(true)

  useEffect(() => {
    if (aiRecommended) {
      setConfig(prev => ({
        ...prev,
        dcfConfig: aiRecommended.dcfConfig,
        dcfSubWeights: aiRecommended.dcfSubWeights,
        modelWeights: aiRecommended.modelWeights,
      }))
      setIsAIDefault(true)
    }
  }, [aiRecommended])

  const updateDCFConfig = useCallback((partial: Partial<DCFConfig>) => {
    setConfig(prev => ({
      ...prev,
      dcfConfig: { ...prev.dcfConfig, ...partial },
    }))
    setIsAIDefault(false)
  }, [])

  const updateDCFSubWeight = useCallback((key: keyof DCFSubWeights, value: number) => {
    setConfig(prev => {
      const adjusted = adjustWeights(
        prev.dcfSubWeights as unknown as Record<string, number>,
        key,
        value,
      )
      return {
        ...prev,
        dcfSubWeights: {
          blended: adjusted.blended ?? 0,
          exitOnly: adjusted.exitOnly ?? 0,
          gordonOnly: adjusted.gordonOnly ?? 0,
        },
      }
    })
    setIsAIDefault(false)
  }, [])

  const updateCompsSubWeight = useCallback((key: keyof CompsSubWeights, value: number) => {
    setConfig(prev => {
      const adjusted = adjustWeights(
        prev.compsSubWeights as unknown as Record<string, number>,
        key,
        value,
      )
      return {
        ...prev,
        compsSubWeights: {
          evEbitda: adjusted.evEbitda ?? 0,
          pe: adjusted.pe ?? 0,
          evSales: adjusted.evSales ?? 0,
          pb: adjusted.pb ?? 0,
        },
      }
    })
    setIsAIDefault(false)
  }, [])

  const updateDDMSubWeight = useCallback((key: keyof DDMSubWeights, value: number) => {
    setConfig(prev => {
      const adjusted = adjustWeights(
        prev.ddmSubWeights as unknown as Record<string, number>,
        key,
        value,
      )
      return {
        ...prev,
        ddmSubWeights: {
          twoStage: adjusted.twoStage ?? 0,
          singleStage: adjusted.singleStage ?? 0,
        },
      }
    })
    setIsAIDefault(false)
  }, [])

  const updateModelWeight = useCallback((key: keyof ModelWeights, value: number) => {
    setConfig(prev => {
      const adjusted = adjustWeights(
        prev.modelWeights as unknown as Record<string, number>,
        key,
        value,
      )
      return {
        ...prev,
        modelWeights: {
          dcf: adjusted.dcf ?? 0,
          comps: adjusted.comps ?? 0,
          ddm: adjusted.ddm ?? 0,
        },
      }
    })
    setIsAIDefault(false)
  }, [])

  const resetToAI = useCallback(() => {
    if (aiRecommended) {
      setConfig(prev => ({
        ...prev,
        dcfConfig: aiRecommended.dcfConfig,
        dcfSubWeights: aiRecommended.dcfSubWeights,
        modelWeights: aiRecommended.modelWeights,
      }))
      setIsAIDefault(true)
    }
  }, [aiRecommended])

  return {
    config,
    isAIDefault,
    updateDCFConfig,
    updateDCFSubWeight,
    updateCompsSubWeight,
    updateDDMSubWeight,
    updateModelWeight,
    resetToAI,
  }
}
