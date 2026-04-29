export interface PeerMultiple {
  ticker: string
  companyName: string
  evToEbitda: number | null
  pe: number | null
  evToSales: number | null
  pb: number | null
}

export interface ImpliedPrice {
  multiple: string
  peerMedian: number | null
  subjectMetric: number | null
  impliedPrice: number | null
  isApplicable: boolean
  reason: string
}

export interface CompsOutput {
  peerTable: PeerMultiple[]
  medians: {
    evToEbitda: number | null
    pe: number | null
    evToSales: number | null
    pb: number | null
  }
  impliedPrices: ImpliedPrice[]
  weightedImpliedPrice: number | null
  /** Optional warning when implied prices could not be derived (e.g. shares unavailable, no peers). */
  warning?: string
  /** Number of peers attempted but dropped due to missing data; surface as a UI nudge. */
  failedPeers?: number
}
