import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { format } from 'date-fns'
import type { ValuationRun } from '../types/ValuationRun.ts'
import { formatCurrency, formatMultiple, formatPercent } from '../utils/formatters.ts'

const PAGE_WIDTH = 595.28
const PAGE_MARGIN = 40
const LINE_HEIGHT = 16

function addPageTitle(pdf: jsPDF, title: string, subtitle?: string): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.text(title, PAGE_MARGIN, 50)

  if (subtitle) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(subtitle, PAGE_MARGIN, 68)
    return 88
  }

  return 74
}

function addRows(pdf: jsPDF, startY: number, rows: Array<[string, string]>): number {
  let currentY = startY

  rows.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text(label, PAGE_MARGIN, currentY)
    pdf.setFont('helvetica', 'normal')
    pdf.text(value, 260, currentY)
    currentY += LINE_HEIGHT
  })

  return currentY
}

function addWrappedParagraph(pdf: jsPDF, text: string, startY: number): number {
  const lines = pdf.splitTextToSize(text, PAGE_WIDTH - PAGE_MARGIN * 2)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(lines, PAGE_MARGIN, startY)
  return startY + lines.length * 12
}

async function captureFootballField(): Promise<string | null> {
  try {
    const element = document.querySelector('[data-export-football-field="true"]') as HTMLElement | null
    if (!element) {
      return null
    }

    const canvas = await html2canvas(element, {
      backgroundColor: '#0D1117',
      scale: 2,
      useCORS: true,
    })

    return canvas.toDataURL('image/png')
  } catch (error) {
    console.warn('Football field capture failed, falling back to text-only PDF export.', error)
    return null
  }
}

export async function exportToPDF(run: ValuationRun): Promise<void> {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const chartImage = await captureFootballField()
  const analysisDate = format(new Date(run.createdAt), 'yyyy-MM-dd HH:mm')

  let y = addPageTitle(pdf, `${run.ticker} Valuation Report`, run.companyName)

  const blendedRows: Array<[string, string]> = [
    ['Analysis Date', analysisDate],
    ['Current Price', formatCurrency(run.currentPrice)],
  ]
  if (run.blendedOutput?.finalPrice !== null && run.blendedOutput?.finalPrice !== undefined) {
    blendedRows.push(['Price Target (Blended)', formatCurrency(run.blendedOutput.finalPrice)])
  }
  blendedRows.push(
    ['DCF (Blended)', formatCurrency(run.dcfOutput?.impliedPrice)],
    ['DDM', formatCurrency(run.ddmOutput?.impliedPrice)],
    ['Comps (Weighted)', formatCurrency(run.compsOutput?.weightedImpliedPrice)],
  )
  if (run.valuationConfig) {
    const cfg = run.valuationConfig
    const mw = cfg.modelWeights
    blendedRows.push(['Model Weights', `DCF ${Math.round(mw.dcf * 100)}% / Comps ${Math.round(mw.comps * 100)}% / DDM ${Math.round(mw.ddm * 100)}%`])
  }
  y = addRows(pdf, y, blendedRows)

  if (run.assumptions?.investment_thesis) {
    y += 16
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.text('Investment Thesis', PAGE_MARGIN, y)
    y = addWrappedParagraph(pdf, run.assumptions.investment_thesis, y + 18)
  }

  pdf.addPage()
  y = addPageTitle(pdf, 'Summary', 'Football field and headline valuation ranges')
  if (chartImage) {
    pdf.addImage(chartImage, 'PNG', PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN * 2, 220)
    y += 250
  }
  y = addRows(pdf, y, [
    ['52-Week Low', formatCurrency(run.financialData?.fiftyTwoWeekLow)],
    ['52-Week High', formatCurrency(run.financialData?.fiftyTwoWeekHigh)],
    ['Scenario Expected Value', formatCurrency(run.scenarioOutput?.expectedPrice)],
  ])

  pdf.addPage()
  y = addPageTitle(pdf, 'DCF', 'WACC, terminal value, and sensitivity summary')
  y = addRows(pdf, y, [
    ['WACC', formatPercent(run.dcfOutput?.wacc)],
    ['PV of FCFs', formatCurrency(run.dcfOutput?.pvFCFTotal, 0)],
    ['PV Terminal (Gordon)', formatCurrency(run.dcfOutput?.pvTerminalGordon, 0)],
    ['PV Terminal (Exit)', formatCurrency(run.dcfOutput?.pvTerminalExitMultiple, 0)],
    ['Implied Price (Gordon)', formatCurrency(run.dcfOutput?.impliedPriceGordon)],
    ['Implied Price (Exit)', formatCurrency(run.dcfOutput?.impliedPriceExitMultiple)],
    ['Implied Price (Blended)', formatCurrency(run.dcfOutput?.impliedPrice)],
  ])

  if (run.ddmOutput?.isApplicable) {
    pdf.addPage()
    y = addPageTitle(pdf, 'DDM', 'Dividend valuation output')
    addRows(pdf, y, [
      ['Current DPS', formatCurrency(run.ddmOutput.currentDPS)],
      ['Required Return', formatPercent(run.ddmOutput.requiredReturn)],
      ['Short-Term Growth', formatPercent(run.ddmOutput.shortTermGrowth)],
      ['Long-Term Growth', formatPercent(run.ddmOutput.longTermGrowth)],
      ['Single-Stage Value', formatCurrency(run.ddmOutput.singleStagePrice)],
      ['Two-Stage Value', formatCurrency(run.ddmOutput.twoStagePrice)],
      ['Implied Price', formatCurrency(run.ddmOutput.impliedPrice)],
    ])
  }

  pdf.addPage()
  y = addPageTitle(pdf, 'Comparable Company Analysis', 'Peer multiple medians and weighted price')
  y = addRows(pdf, y, [
    ['Median EV/EBITDA', formatMultiple(run.compsOutput?.medians.evToEbitda)],
    ['Median P/E', formatMultiple(run.compsOutput?.medians.pe)],
    ['Median EV/Sales', formatMultiple(run.compsOutput?.medians.evToSales)],
    ['Median P/B', formatMultiple(run.compsOutput?.medians.pb)],
    ['Weighted Implied Price', formatCurrency(run.compsOutput?.weightedImpliedPrice)],
  ])

  pdf.addPage()
  y = addPageTitle(pdf, 'Scenario Analysis', 'Bear, base, bull, and probability-weighted value')
  addRows(pdf, y, [
    ['Bear Weighted Price', formatCurrency(run.scenarioOutput?.bear.weightedPrice)],
    ['Base Weighted Price', formatCurrency(run.scenarioOutput?.base.weightedPrice)],
    ['Bull Weighted Price', formatCurrency(run.scenarioOutput?.bull.weightedPrice)],
    ['Expected Value', formatCurrency(run.scenarioOutput?.expectedPrice)],
    ['Bear Probability', `${Math.round((run.scenarioOutput?.probabilityWeights.bear ?? 0) * 100)}%`],
    ['Base Probability', `${Math.round((run.scenarioOutput?.probabilityWeights.base ?? 0) * 100)}%`],
    ['Bull Probability', `${Math.round((run.scenarioOutput?.probabilityWeights.bull ?? 0) * 100)}%`],
  ])

  const filename = `${run.ticker}_Valuation_${format(new Date(run.createdAt), 'yyyyMMdd')}.pdf`
  pdf.save(filename)
}
