export type CritiqueSeverity = 'critical' | 'warning' | 'info'
export type CritiqueGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type CategoryGrade = 'pass' | 'warn' | 'fail'

export interface CritiqueIssue {
  check: string
  severity: CritiqueSeverity
  category: string
  message: string
  detail: string
  suggestion: string
}

export interface CritiqueCategory {
  name: string
  icon: string
  grade: CategoryGrade
  issues: CritiqueIssue[]
}

export interface CritiqueReport {
  ticker: string
  overall_grade: CritiqueGrade
  overall_score: number
  categories: CritiqueCategory[]
  issues: CritiqueIssue[]
  summary: string
  auto_refinable: boolean
}

export interface RefineResponse {
  revised_assumptions: Record<string, unknown>
  changes_made: string[]
  rationale: string
}
