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
}
