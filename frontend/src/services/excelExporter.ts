/**
 * Excel export service — generates .xlsx matching Smit Financial Model structure.
 * Uses ExcelJS for styled output (fills, bold headers, conditional coloring, freeze panes).
 */
import ExcelJS from 'exceljs'
import type { ValuationRun } from '../types/ValuationRun.ts'
import type { SourcedAssumption } from '../types/Assumptions.ts'
import { TerminalValueMethod, CashFlowBasis, DiscountingConvention } from '../types/ValuationConfig.ts'
import { format } from 'date-fns'

interface AssumptionExportRow {
  label: string
  value: string | number | boolean | null
  source: string
  confidence: string
  rationale: string
}

type CellValue = string | number | boolean | null | Date

function isSourcedAssumption(value: unknown): value is SourcedAssumption {
  return typeof value === 'object' && value !== null && 'value' in value && 'source' in value
}

function humanizeLabel(path: string): string {
  return path
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\d+\b/g, match => `Y${Number(match) + 1}`)
    .replace(/\b\w/g, char => char.toUpperCase())
}

function collectAssumptionRows(label: string, value: unknown, rows: AssumptionExportRow[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAssumptionRows(`${label}.${index}`, item, rows))
    return
  }

  if (isSourcedAssumption(value)) {
    rows.push({
      label: humanizeLabel(label),
      value: value.value,
      source: value.source,
      confidence: value.confidence,
      rationale: value.rationale,
    })
    return
  }

  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, child]) => collectAssumptionRows(`${label}.${key}`, child, rows))
    return
  }

  rows.push({
    label: humanizeLabel(label),
    value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null,
    source: 'System / User Input',
    confidence: '',
    rationale: '',
  })
}

function setColumnWidths(ws: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

function freezeHeader(ws: ExcelJS.Worksheet, ySplit = 1): void {
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit }]
}

function setFill(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
  }
}

// ============================================================================
// Cover Sheet
// ============================================================================

function buildCoverSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Cover')
  const scenario = run.scenarioOutput
  const blend = run.blendedOutput
  const currentPrice = run.currentPrice ?? 0
  const blendedPrice = blend?.finalPrice ?? null
  const upside = blendedPrice !== null && currentPrice > 0 ? (blendedPrice - currentPrice) / currentPrice : null

  // Title block — merged A1:D2
  ws.mergeCells('A1:D2')
  const titleCell = ws.getCell('A1')
  titleCell.value = run.companyName || run.ticker
  titleCell.font = { bold: true, size: 22, color: { argb: 'FF1F2937' } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  setFill(titleCell, 'FFF3F4F6')

  // Ticker under title
  ws.mergeCells('A3:D3')
  const tickerCell = ws.getCell('A3')
  tickerCell.value = `Ticker: ${run.ticker}`
  tickerCell.font = { bold: true, size: 14, color: { argb: 'FF4B5563' } }
  tickerCell.alignment = { horizontal: 'left' }

  // Blank row
  ws.addRow([])

  // Key metrics table starting row 5
  const rowsToAdd: Array<[string, CellValue, string?]> = [
    ['Run Date', format(new Date(run.createdAt), 'MMMM d, yyyy h:mm a')],
    ['Current Price', currentPrice],
    ['Blended Price Target', blendedPrice],
    ['Upside / Downside', upside],
  ]

  rowsToAdd.forEach(([label, value]) => {
    const row = ws.addRow([label, value])
    row.getCell(1).font = { bold: true }
    row.getCell(1).alignment = { horizontal: 'left' }
  })

  // Format currency/percent cells
  const currentPriceRow = 6
  const blendedPriceRow = 7
  const upsideRow = 8

  ws.getCell(`B${currentPriceRow}`).numFmt = '"$"#,##0.00'
  ws.getCell(`B${blendedPriceRow}`).numFmt = '"$"#,##0.00'
  ws.getCell(`B${blendedPriceRow}`).font = { bold: true, color: { argb: 'FF047857' } }

  const upsideCell = ws.getCell(`B${upsideRow}`)
  upsideCell.numFmt = '0.0%'
  if (upside !== null) {
    upsideCell.font = { bold: true, color: { argb: upside >= 0 ? 'FF047857' : 'FFB91C1C' } }
  }

  ws.addRow([])

  // Scenario section header
  const scenarioHeaderRow = ws.addRow(['Scenario Prices (Probability-Weighted)'])
  scenarioHeaderRow.getCell(1).font = { bold: true, size: 12 }
  ws.mergeCells(`A${scenarioHeaderRow.number}:D${scenarioHeaderRow.number}`)
  setFill(ws.getCell(`A${scenarioHeaderRow.number}`), 'FFE5E7EB')

  if (scenario) {
    const p = scenario.probabilityWeights ?? { bear: 0.25, base: 0.5, bull: 0.25 }
    const cases: Array<[string, number | null, number]> = [
      ['Bear', scenario.bear.weightedPrice, p.bear],
      ['Base', scenario.base.weightedPrice, p.base],
      ['Bull', scenario.bull.weightedPrice, p.bull],
    ]
    cases.forEach(([label, price, prob]) => {
      const r = ws.addRow([label, price, prob])
      r.getCell(1).font = { bold: true }
      r.getCell(2).numFmt = '"$"#,##0.00'
      r.getCell(3).numFmt = '0%'
    })
    const expectedRow = ws.addRow(['Expected Value', scenario.expectedPrice, 1.0])
    expectedRow.getCell(1).font = { bold: true }
    expectedRow.getCell(2).numFmt = '"$"#,##0.00'
    expectedRow.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
    expectedRow.getCell(3).numFmt = '0%'
  } else {
    ws.addRow(['Scenario data not available'])
  }

  ws.addRow([])

  // Investment Thesis
  const thesisHeader = ws.addRow(['Investment Thesis'])
  thesisHeader.getCell(1).font = { bold: true, size: 12 }
  ws.mergeCells(`A${thesisHeader.number}:D${thesisHeader.number}`)
  setFill(ws.getCell(`A${thesisHeader.number}`), 'FFE5E7EB')

  const thesisText = run.assumptions?.investment_thesis ?? 'No investment thesis available.'
  const thesisRow = ws.addRow([thesisText])
  ws.mergeCells(`A${thesisRow.number}:D${thesisRow.number}`)
  thesisRow.getCell(1).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' }
  thesisRow.height = 120

  // Key Risks
  if (run.assumptions?.key_risks && run.assumptions.key_risks.length > 0) {
    ws.addRow([])
    const risksHeader = ws.addRow(['Key Risks'])
    risksHeader.getCell(1).font = { bold: true, size: 12 }
    ws.mergeCells(`A${risksHeader.number}:D${risksHeader.number}`)
    setFill(ws.getCell(`A${risksHeader.number}`), 'FFE5E7EB')
    run.assumptions.key_risks.forEach(risk => {
      const r = ws.addRow([`• ${risk}`])
      ws.mergeCells(`A${r.number}:D${r.number}`)
      r.getCell(1).alignment = { wrapText: true }
    })
  }

  setColumnWidths(ws, [28, 22, 18, 18])
  freezeHeader(ws, 3)
}

// ============================================================================
// Sensitivity Analysis Sheet
// ============================================================================

function buildSensitivityAnalysisSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Sensitivity Analysis')
  const dcf = run.dcfOutput
  const currentPrice = run.currentPrice ?? 0
  const baseWacc = dcf?.wacc ?? null
  const baseExitMultiple = run.assumptions?.dcf?.exit_multiple?.value ?? null

  // Title
  ws.mergeCells('A1:H1')
  const title = ws.getCell('A1')
  title.value = 'WACC vs Exit Multiple Sensitivity'
  title.font = { bold: true, size: 14 }
  title.alignment = { horizontal: 'left', vertical: 'middle' }
  setFill(title, 'FFE5E7EB')

  // Current price reference
  const infoRow = ws.addRow([`Current Price: $${currentPrice.toFixed(2)}  |  Green = Implied > Current  |  Red = Implied < Current`])
  ws.mergeCells(`A${infoRow.number}:H${infoRow.number}`)
  infoRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }

  ws.addRow([])

  if (!dcf || !dcf.sensitivityMatrix.length) {
    ws.addRow(['Sensitivity data not available'])
    setColumnWidths(ws, [14, 14, 14, 14, 14, 14, 14, 14])
    freezeHeader(ws, 1)
    return
  }

  // Header row: "WACC \ Exit", then exit multiples
  const headerRow = ws.addRow(['WACC \\ Exit', ...dcf.sensitivityTerminalRange.map(t => `${t.toFixed(1)}x`)])
  headerRow.eachCell(cell => {
    cell.font = { bold: true }
    setFill(cell, 'FFD1D5DB')
    cell.alignment = { horizontal: 'center' }
  })
  const headerRowNum = headerRow.number

  // Find base-case WACC row index and base exit multiple column index (closest match)
  let baseWaccIdx = -1
  let baseExitIdx = -1
  if (baseWacc !== null) {
    let bestDist = Infinity
    dcf.sensitivityWACCRange.forEach((w, idx) => {
      const d = Math.abs(w - baseWacc)
      if (d < bestDist) { bestDist = d; baseWaccIdx = idx }
    })
  }
  if (baseExitMultiple !== null) {
    let bestDist = Infinity
    dcf.sensitivityTerminalRange.forEach((t, idx) => {
      const d = Math.abs(t - baseExitMultiple)
      if (d < bestDist) { bestDist = d; baseExitIdx = idx }
    })
  }

  // Data rows
  dcf.sensitivityMatrix.forEach((matrixRow, i) => {
    const wacc = dcf.sensitivityWACCRange[i]
    const row = ws.addRow([`${(wacc * 100).toFixed(1)}%`, ...matrixRow.map(v => Math.round(v * 100) / 100)])
    // Label cell formatting
    row.getCell(1).font = { bold: i === baseWaccIdx, italic: i !== baseWaccIdx }
    setFill(row.getCell(1), 'FFF3F4F6')
    row.getCell(1).alignment = { horizontal: 'right' }

    // Data cells
    matrixRow.forEach((price, j) => {
      const cell = row.getCell(j + 2)
      cell.numFmt = '"$"#,##0.00'
      cell.alignment = { horizontal: 'right' }
      const fill = price > currentPrice ? 'FFCCFFCC' : price < currentPrice ? 'FFFFCCCC' : 'FFFFFFCC'
      setFill(cell, fill)
      // Bold the base-case column
      if (j === baseExitIdx) {
        cell.font = { bold: true }
      }
      if (i === baseWaccIdx) {
        cell.font = { ...(cell.font ?? {}), bold: true }
      }
    })
  })

  // Legend below
  ws.addRow([])
  const legendRow = ws.addRow(['Bold = Base Case', `Base WACC: ${baseWacc !== null ? (baseWacc * 100).toFixed(2) + '%' : 'N/A'}`, `Base Exit Multiple: ${baseExitMultiple !== null ? baseExitMultiple.toFixed(1) + 'x' : 'N/A'}`])
  legendRow.getCell(1).font = { italic: true }

  const colCount = 1 + dcf.sensitivityTerminalRange.length
  const widths = [16, ...Array(colCount - 1).fill(14)]
  setColumnWidths(ws, widths)
  freezeHeader(ws, headerRowNum)
}

// ============================================================================
// WACC Build-Up Sheet
// ============================================================================

function buildWaccBuildUpSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('WACC Build-Up')
  const wacc = run.assumptions?.wacc
  const dcf = run.dcfOutput

  // Header row
  const header = ws.addRow(['Component', 'Value', 'Source / Notes'])
  header.eachCell(cell => {
    cell.font = { bold: true }
    setFill(cell, 'FFD1D5DB')
  })

  if (!wacc) {
    ws.addRow(['WACC assumptions not available'])
    setColumnWidths(ws, [32, 18, 50])
    freezeHeader(ws)
    return
  }

  const rf = wacc.risk_free_rate
  const erp = wacc.equity_risk_premium
  const beta = wacc.beta
  const sp = wacc.size_premium
  const kd = wacc.cost_of_debt
  const tax = wacc.tax_rate
  const we = wacc.equity_weight
  const wd = wacc.debt_weight

  const ke = dcf?.costOfEquity ?? (rf.value + beta.value * erp.value + sp.value)
  const atKd = dcf?.afterTaxCostOfDebt ?? (kd.value * (1 - tax.value))
  const finalWacc = dcf?.wacc ?? (we.value * ke + wd.value * atKd)

  const rows: Array<[string, number, string, 'pct' | 'num' | 'pct-calc' | 'num-calc' | 'final']> = [
    ['Risk-Free Rate (Rf)', rf.value, rf.source, 'pct'],
    ['Equity Risk Premium (ERP)', erp.value, erp.source, 'pct'],
    ['Beta', beta.value, beta.source, 'num'],
    ['Size Premium', sp.value, sp.source, 'pct'],
    ['Cost of Equity (Ke)', ke, 'Calculated: Rf + Beta × ERP + Size Premium', 'pct-calc'],
    ['Pre-Tax Cost of Debt (Kd)', kd.value, kd.source, 'pct'],
    ['Tax Rate', tax.value, tax.source, 'pct'],
    ['After-Tax Cost of Debt', atKd, 'Calculated: Kd × (1 − Tax Rate)', 'pct-calc'],
    ['Equity Weight (We)', we.value, we.source, 'pct'],
    ['Debt Weight (Wd)', wd.value, wd.source, 'pct'],
    ['WACC', finalWacc, 'Calculated: We × Ke + Wd × Kd × (1 − T)', 'final'],
  ]

  rows.forEach(([label, value, source, type]) => {
    const r = ws.addRow([label, value, source])
    const labelCell = r.getCell(1)
    const valueCell = r.getCell(2)
    const sourceCell = r.getCell(3)

    labelCell.alignment = { horizontal: 'left' }
    sourceCell.alignment = { horizontal: 'left', wrapText: true }

    if (type === 'num') {
      valueCell.numFmt = '0.000'
    } else if (type === 'num-calc') {
      valueCell.numFmt = '0.000'
      labelCell.font = { italic: true }
      sourceCell.font = { italic: true, color: { argb: 'FF6B7280' } }
    } else if (type === 'pct') {
      valueCell.numFmt = '0.00%'
    } else if (type === 'pct-calc') {
      valueCell.numFmt = '0.00%'
      labelCell.font = { italic: true }
      sourceCell.font = { italic: true, color: { argb: 'FF6B7280' } }
      setFill(valueCell, 'FFFEF3C7')
    } else if (type === 'final') {
      valueCell.numFmt = '0.00%'
      labelCell.font = { bold: true, size: 12 }
      valueCell.font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } }
      setFill(valueCell, 'FFDBEAFE')
      setFill(labelCell, 'FFDBEAFE')
      setFill(sourceCell, 'FFDBEAFE')
      sourceCell.font = { italic: true }
    }
    valueCell.alignment = { horizontal: 'right' }
  })

  setColumnWidths(ws, [32, 18, 55])
  freezeHeader(ws)
}

// ============================================================================
// Financial Statement Forecast
// ============================================================================

function buildFinancialStatementForecastSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Financial Statement Forecast')
  const projections = run.dcfOutput?.projections ?? []
  const revenueHistory = run.financialData?.revenueHistory ?? []
  const ebitdaHistory = run.financialData?.ebitdaHistory ?? []

  // Header row
  const historicalCount = revenueHistory.length
  const headers: CellValue[] = ['Metric']
  revenueHistory.forEach(h => headers.push(h.year))
  projections.forEach(p => headers.push(`Year ${p.year}`))
  const headerRow = ws.addRow(headers)
  headerRow.eachCell((cell, col) => {
    cell.font = { bold: true }
    setFill(cell, 'FFD1D5DB')
    cell.alignment = { horizontal: 'center' }
    // Shade historical vs projected columns differently
    if (col > 1 && col <= historicalCount + 1) {
      setFill(cell, 'FFE0E7FF') // light blue for historical
    } else if (col > historicalCount + 1) {
      setFill(cell, 'FFDCFCE7') // light green for projected
    }
  })

  // Revenue
  const revRow: CellValue[] = ['Revenue']
  revenueHistory.forEach(h => revRow.push(h.value))
  projections.forEach(p => revRow.push(p.revenue))
  const revR = ws.addRow(revRow)
  for (let i = 2; i <= revRow.length; i++) revR.getCell(i).numFmt = '"$"#,##0'

  // Revenue growth
  const growthRow: CellValue[] = ['Revenue Growth [A]']
  revenueHistory.forEach(() => growthRow.push(null))
  projections.forEach(p => growthRow.push(p.revenueGrowth))
  const grR = ws.addRow(growthRow)
  for (let i = 2; i <= growthRow.length; i++) grR.getCell(i).numFmt = '0.0%'

  // EBITDA
  const ebitdaRow: CellValue[] = ['EBITDA']
  ebitdaHistory.forEach(h => ebitdaRow.push(h.value))
  projections.forEach(p => ebitdaRow.push(p.ebitda))
  const ebR = ws.addRow(ebitdaRow)
  for (let i = 2; i <= ebitdaRow.length; i++) ebR.getCell(i).numFmt = '"$"#,##0'

  // EBITDA margin
  const marginRow: CellValue[] = ['EBITDA Margin [A]']
  ebitdaHistory.forEach(() => marginRow.push(null))
  projections.forEach(p => marginRow.push(p.ebitdaMargin))
  const mR = ws.addRow(marginRow)
  for (let i = 2; i <= marginRow.length; i++) mR.getCell(i).numFmt = '0.0%'

  // CapEx
  const capexRow: CellValue[] = ['CapEx']
  revenueHistory.forEach(() => capexRow.push(null))
  projections.forEach(p => capexRow.push(-p.capex))
  const cR = ws.addRow(capexRow)
  for (let i = 2; i <= capexRow.length; i++) cR.getCell(i).numFmt = '"$"#,##0'

  // FCF
  const fcfRow: CellValue[] = ['Free Cash Flow']
  revenueHistory.forEach(() => fcfRow.push(null))
  projections.forEach(p => fcfRow.push(p.freeCashFlow))
  const fR = ws.addRow(fcfRow)
  fR.font = { bold: true }
  for (let i = 2; i <= fcfRow.length; i++) fR.getCell(i).numFmt = '"$"#,##0'

  ws.addRow([])
  ws.addRow(['[A] = Hardcoded assumption (editable)'])

  const colCount = headers.length
  setColumnWidths(ws, [28, ...Array(colCount - 1).fill(16)])
  freezeHeader(ws)
}

// ============================================================================
// DCF Sheet
// ============================================================================

function buildDCFSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('DCF')
  const dcf = run.dcfOutput
  const wacc = run.assumptions?.wacc
  const revenueHistory = run.financialData?.revenueHistory ?? []

  // Header block
  const title = ws.addRow(['DCF Valuation Model'])
  title.getCell(1).font = { bold: true, size: 14 }
  ws.mergeCells(`A${title.number}:G${title.number}`)
  setFill(ws.getCell(`A${title.number}`), 'FFE5E7EB')

  ws.addRow([])

  // WACC Build-Up Section
  const waccHeader = ws.addRow(['WACC Build-Up', 'Value', 'Source'])
  waccHeader.eachCell(cell => {
    cell.font = { bold: true }
    setFill(cell, 'FFD1D5DB')
  })

  if (wacc) {
    const rows: Array<[string, number | null, string, 'pct' | 'num']> = [
      ['Risk-Free Rate [A]', wacc.risk_free_rate.value, wacc.risk_free_rate.source, 'pct'],
      ['Equity Risk Premium [A]', wacc.equity_risk_premium.value, wacc.equity_risk_premium.source, 'pct'],
      ['Beta [A]', wacc.beta.value, wacc.beta.source, 'num'],
      ['Size Premium [A]', wacc.size_premium.value, wacc.size_premium.source, 'pct'],
      ['Cost of Equity', dcf?.costOfEquity ?? null, 'Calculated: Rf + Beta*ERP + SP', 'pct'],
    ]
    rows.forEach(([label, value, source, type]) => {
      const r = ws.addRow([label, value, source])
      r.getCell(2).numFmt = type === 'pct' ? '0.00%' : '0.000'
    })

    ws.addRow([])

    const rows2: Array<[string, number | null, string, 'pct' | 'num']> = [
      ['Cost of Debt [A]', wacc.cost_of_debt.value, wacc.cost_of_debt.source, 'pct'],
      ['Tax Rate [A]', wacc.tax_rate.value, wacc.tax_rate.source, 'pct'],
      ['After-Tax Cost of Debt', dcf?.afterTaxCostOfDebt ?? null, 'Calculated: Kd*(1-T)', 'pct'],
    ]
    rows2.forEach(([label, value, source, type]) => {
      const r = ws.addRow([label, value, source])
      r.getCell(2).numFmt = type === 'pct' ? '0.00%' : '0.000'
    })

    ws.addRow([])

    const rows3: Array<[string, number | null, string]> = [
      ['Debt Weight [A]', wacc.debt_weight.value, wacc.debt_weight.source],
      ['Equity Weight [A]', wacc.equity_weight.value, wacc.equity_weight.source],
    ]
    rows3.forEach(([label, value, source]) => {
      const r = ws.addRow([label, value, source])
      r.getCell(2).numFmt = '0.00%'
    })

    const waccFinalRow = ws.addRow(['WACC', dcf?.wacc ?? null, 'Calculated: We*Ke + Wd*Kd*(1-T)'])
    waccFinalRow.getCell(1).font = { bold: true }
    waccFinalRow.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
    waccFinalRow.getCell(2).numFmt = '0.00%'
    setFill(waccFinalRow.getCell(1), 'FFDBEAFE')
    setFill(waccFinalRow.getCell(2), 'FFDBEAFE')
    setFill(waccFinalRow.getCell(3), 'FFDBEAFE')
  }

  ws.addRow([])

  if (!dcf) {
    setColumnWidths(ws, [32, 16, 16, 16, 16, 16, 16])
    freezeHeader(ws)
    return
  }

  // FCF projection table — with historical + projected columns
  const historicalYears = revenueHistory.map(h => h.year)
  const projectionYears = dcf.projections.map(p => `Year ${p.year}`)
  const fcfHeader = ws.addRow(['FCF Projections', ...historicalYears, ...projectionYears])
  fcfHeader.eachCell((cell, col) => {
    cell.font = { bold: true }
    setFill(cell, 'FFD1D5DB')
    cell.alignment = { horizontal: 'center' }
    // Shade historical vs projected
    if (col > 1 && col <= historicalYears.length + 1) {
      setFill(cell, 'FFE0E7FF')
    } else if (col > historicalYears.length + 1) {
      setFill(cell, 'FFDCFCE7')
    }
  })

  const histCount = historicalYears.length

  // Historical revenue + projected revenue
  const revCells: CellValue[] = ['Revenue']
  revenueHistory.forEach(h => revCells.push(h.value))
  dcf.projections.forEach(p => revCells.push(p.revenue))
  const revR = ws.addRow(revCells)
  for (let i = 2; i <= revCells.length; i++) revR.getCell(i).numFmt = '"$"#,##0'

  // Revenue growth (projected only)
  const growthCells: CellValue[] = ['Revenue Growth [A]']
  historicalYears.forEach(() => growthCells.push(null))
  dcf.projections.forEach(p => growthCells.push(p.revenueGrowth))
  const grR = ws.addRow(growthCells)
  for (let i = 2; i <= growthCells.length; i++) grR.getCell(i).numFmt = '0.0%'

  // EBITDA
  const ebitdaHistory = run.financialData?.ebitdaHistory ?? []
  const ebCells: CellValue[] = ['EBITDA']
  for (let i = 0; i < histCount; i++) {
    const h = ebitdaHistory[i]
    ebCells.push(h ? h.value : null)
  }
  dcf.projections.forEach(p => ebCells.push(p.ebitda))
  const ebR = ws.addRow(ebCells)
  for (let i = 2; i <= ebCells.length; i++) ebR.getCell(i).numFmt = '"$"#,##0'

  // Taxes (projected only)
  const taxCells: CellValue[] = ['Taxes']
  historicalYears.forEach(() => taxCells.push(null))
  dcf.projections.forEach(p => taxCells.push(p.taxes))
  const txR = ws.addRow(taxCells)
  for (let i = 2; i <= taxCells.length; i++) txR.getCell(i).numFmt = '"$"#,##0'

  // CapEx
  const capexCells: CellValue[] = ['CapEx']
  historicalYears.forEach(() => capexCells.push(null))
  dcf.projections.forEach(p => capexCells.push(-p.capex))
  const cxR = ws.addRow(capexCells)
  for (let i = 2; i <= capexCells.length; i++) cxR.getCell(i).numFmt = '"$"#,##0'

  // NWC Change
  const nwcCells: CellValue[] = ['NWC Change']
  historicalYears.forEach(() => nwcCells.push(null))
  dcf.projections.forEach(p => nwcCells.push(-p.nwcChange))
  const nwR = ws.addRow(nwcCells)
  for (let i = 2; i <= nwcCells.length; i++) nwR.getCell(i).numFmt = '"$"#,##0'

  // FCFF (Free Cash Flow to Firm)
  const fcffCells: CellValue[] = ['FCFF']
  historicalYears.forEach(() => fcffCells.push(null))
  dcf.projections.forEach(p => fcffCells.push(p.freeCashFlow))
  const fcffR = ws.addRow(fcffCells)
  fcffR.font = { bold: true }
  for (let i = 2; i <= fcffCells.length; i++) fcffR.getCell(i).numFmt = '"$"#,##0'

  // Discount Factor
  const dfCells: CellValue[] = ['Discount Factor']
  historicalYears.forEach(() => dfCells.push(null))
  dcf.projections.forEach(p => dfCells.push(p.discountFactor))
  const dfR = ws.addRow(dfCells)
  for (let i = 2; i <= dfCells.length; i++) dfR.getCell(i).numFmt = '0.0000'

  // PV of FCFF
  const pvCells: CellValue[] = ['PV of FCFF']
  historicalYears.forEach(() => pvCells.push(null))
  dcf.projections.forEach(p => pvCells.push(p.pvFCF))
  const pvR = ws.addRow(pvCells)
  pvR.font = { bold: true }
  for (let i = 2; i <= pvCells.length; i++) pvR.getCell(i).numFmt = '"$"#,##0'
  setFill(pvR.getCell(1), 'FFDCFCE7')

  // Apply borders to separate historical from projected cells on data rows
  const dataRowStart = fcfHeader.number
  const dataRowEnd = pvR.number
  const sepCol = histCount + 1 // last historical col
  if (histCount > 0) {
    for (let r = dataRowStart; r <= dataRowEnd; r++) {
      const cell = ws.getRow(r).getCell(sepCol)
      cell.border = { ...(cell.border ?? {}), right: { style: 'medium', color: { argb: 'FF374151' } } }
    }
  }

  ws.addRow([])

  // Valuation Summary
  const summaryHeader = ws.addRow(['Valuation Summary'])
  summaryHeader.getCell(1).font = { bold: true, size: 12 }
  setFill(summaryHeader.getCell(1), 'FFE5E7EB')

  const summaryRows: Array<[string, number | null, 'currency' | 'number']> = [
    ['PV of FCFs', dcf.pvFCFTotal, 'currency'],
    ['Terminal Value (Gordon Growth)', dcf.terminalValueGordon, 'currency'],
    ['Terminal Value (Exit Multiple)', dcf.terminalValueExitMultiple, 'currency'],
    ['PV Terminal (Gordon)', dcf.pvTerminalGordon, 'currency'],
    ['PV Terminal (Exit Multiple)', dcf.pvTerminalExitMultiple, 'currency'],
    ['Enterprise Value (Gordon)', dcf.enterpriseValueGordon, 'currency'],
    ['Enterprise Value (Exit Multiple)', dcf.enterpriseValueExitMultiple, 'currency'],
    ['Net Debt', dcf.netDebt, 'currency'],
    ['Equity Value (Gordon)', dcf.equityValueGordon, 'currency'],
    ['Equity Value (Exit Multiple)', dcf.equityValueExitMultiple, 'currency'],
    ['Shares Outstanding', dcf.sharesOutstanding, 'number'],
    ['Implied Price (Gordon)', dcf.impliedPriceGordon, 'currency'],
    ['Implied Price (Exit Multiple)', dcf.impliedPriceExitMultiple, 'currency'],
    ['Implied Price (Blended)', dcf.impliedPrice, 'currency'],
  ]
  summaryRows.forEach(([label, value, type]) => {
    const r = ws.addRow([label, value])
    r.getCell(1).alignment = { horizontal: 'left' }
    r.getCell(2).numFmt = type === 'currency' ? '"$"#,##0' : '#,##0'
    if (label === 'Implied Price (Blended)') {
      r.getCell(1).font = { bold: true }
      r.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
      setFill(r.getCell(1), 'FFDBEAFE')
      setFill(r.getCell(2), 'FFDBEAFE')
      r.getCell(2).numFmt = '"$"#,##0.00'
    }
  })

  ws.addRow([])
  ws.addRow(['[A] = Hardcoded assumption (editable input)'])

  const totalCols = 1 + histCount + dcf.projections.length
  setColumnWidths(ws, [32, ...Array(totalCols - 1).fill(16)])
  freezeHeader(ws)
}

// ============================================================================
// DDM Sheet
// ============================================================================

function buildDDMSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('DDM')
  const ddm = run.ddmOutput

  const title = ws.addRow(['Dividend Discount Model'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')

  ws.addRow([])

  const h = ws.addRow(['Applicability Check', 'Result', 'Detail'])
  h.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  if (ddm) {
    ddm.applicabilityCriteria.forEach(c => {
      const r = ws.addRow([c.name, c.pass ? 'PASS' : 'FAIL', c.detail])
      r.getCell(2).font = { bold: true, color: { argb: c.pass ? 'FF047857' : 'FFB91C1C' } }
    })
    const overall = ws.addRow(['Overall', ddm.isApplicable ? 'APPLICABLE' : 'NOT APPLICABLE', `Score: ${ddm.applicabilityScore}/4`])
    overall.font = { bold: true }
  }

  if (ddm?.isApplicable) {
    ws.addRow([])
    const inputsHeader = ws.addRow(['DDM Inputs', 'Value'])
    inputsHeader.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

    const inputRows: Array<[string, number | null, string]> = [
      ['Current DPS', ddm.currentDPS, 'currency'],
      ['Required Return (ke) [A]', ddm.requiredReturn, 'pct'],
      ['Short-Term Growth [A]', ddm.shortTermGrowth, 'pct'],
      ['Long-Term Growth [A]', ddm.longTermGrowth, 'pct'],
    ]
    inputRows.forEach(([label, val, fmt]) => {
      const r = ws.addRow([label, val])
      r.getCell(2).numFmt = fmt === 'pct' ? '0.00%' : '"$"#,##0.00'
    })

    ws.addRow([])
    const resHeader = ws.addRow(['Results'])
    resHeader.getCell(1).font = { bold: true }
    setFill(resHeader.getCell(1), 'FFE5E7EB')

    const resultRows: Array<[string, number | null]> = [
      ['Single-Stage Price', ddm.singleStagePrice],
      ['Two-Stage Price', ddm.twoStagePrice],
      ['Implied Price', ddm.impliedPrice],
    ]
    resultRows.forEach(([label, val]) => {
      const r = ws.addRow([label, val])
      r.getCell(2).numFmt = '"$"#,##0.00'
      if (label === 'Implied Price') {
        r.getCell(1).font = { bold: true }
        r.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
      }
    })

    if (ddm.dpsProjections.length > 0) {
      ws.addRow([])
      const dpsH = ws.addRow(['DPS Projections', 'DPS', 'Growth', 'PV of DPS'])
      dpsH.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })
      ddm.dpsProjections.forEach(p => {
        const r = ws.addRow([`Year ${p.year}`, p.dps, p.growthRate, p.pvDPS])
        r.getCell(2).numFmt = '"$"#,##0.00'
        r.getCell(3).numFmt = '0.0%'
        r.getCell(4).numFmt = '"$"#,##0.00'
      })
    }
  }

  setColumnWidths(ws, [30, 18, 18, 18])
  freezeHeader(ws)
}

// ============================================================================
// Relative Valuation Sheet
// ============================================================================

function buildRelativeValuationSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Relative Valuation')
  const comps = run.compsOutput

  const title = ws.addRow(['Relative Valuation (Comparable Company Analysis)'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')

  ws.addRow([])

  if (!comps) {
    ws.addRow(['Comps data not available'])
    setColumnWidths(ws, [12, 25, 14, 14, 14, 14])
    freezeHeader(ws)
    return
  }

  const h = ws.addRow(['Ticker', 'Company', 'EV/EBITDA', 'P/E', 'EV/Sales', 'P/B'])
  h.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  comps.peerTable.forEach(p => {
    const r = ws.addRow([p.ticker, p.companyName, p.evToEbitda, p.pe, p.evToSales, p.pb])
    for (let i = 3; i <= 6; i++) r.getCell(i).numFmt = '0.00'
  })
  const medianRow = ws.addRow(['MEDIAN', '', comps.medians.evToEbitda, comps.medians.pe, comps.medians.evToSales, comps.medians.pb])
  medianRow.font = { bold: true }
  setFill(medianRow.getCell(1), 'FFFEF3C7')
  for (let i = 3; i <= 6; i++) medianRow.getCell(i).numFmt = '0.00'

  ws.addRow([])
  const impHeader = ws.addRow(['Implied Prices', 'Peer Median', 'Implied Price', 'Status'])
  impHeader.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })
  comps.impliedPrices.forEach(ip => {
    const r = ws.addRow([ip.multiple, ip.peerMedian, ip.impliedPrice, ip.isApplicable ? 'Applied' : ip.reason])
    r.getCell(2).numFmt = '0.00'
    r.getCell(3).numFmt = '"$"#,##0.00'
  })
  ws.addRow([])
  const wR = ws.addRow(['Weighted Implied Price', comps.weightedImpliedPrice])
  wR.getCell(1).font = { bold: true }
  wR.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
  wR.getCell(2).numFmt = '"$"#,##0.00'

  setColumnWidths(ws, [14, 28, 14, 14, 14, 18])
  freezeHeader(ws)
}

// ============================================================================
// Scenario Sheet
// ============================================================================

function buildScenarioSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Scenario Analysis')
  const scenario = run.scenarioOutput

  const title = ws.addRow(['Scenario Analysis'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')

  ws.addRow([])

  if (!scenario) {
    ws.addRow(['Scenario data not available'])
    setColumnWidths(ws, [30, 18, 18, 18])
    freezeHeader(ws)
    return
  }

  const probabilityWeights = scenario.probabilityWeights ?? { bear: 0.25, base: 0.5, bull: 0.25 }

  const driverHeader = ws.addRow(['Assumption Drivers', 'Bear', 'Base', 'Bull'])
  driverHeader.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  scenario.drivers.forEach(d => {
    const r = ws.addRow([d.assumption, d.bearValue, d.baseValue, d.bullValue])
    for (let i = 2; i <= 4; i++) r.getCell(i).numFmt = '0.000'
  })

  ws.addRow([])
  const pR = ws.addRow(['Probability Weights', probabilityWeights.bear, probabilityWeights.base, probabilityWeights.bull])
  pR.getCell(1).font = { bold: true }
  for (let i = 2; i <= 4; i++) pR.getCell(i).numFmt = '0%'

  ws.addRow([])
  const priceHeader = ws.addRow(['Implied Prices', 'Bear', 'Base', 'Bull'])
  priceHeader.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  const priceRows: Array<[string, number | null, number | null, number | null]> = [
    ['DCF', scenario.bear.dcfPrice, scenario.base.dcfPrice, scenario.bull.dcfPrice],
    ['DDM', scenario.bear.ddmPrice, scenario.base.ddmPrice, scenario.bull.ddmPrice],
    ['Comps', scenario.bear.compsPrice, scenario.base.compsPrice, scenario.bull.compsPrice],
    ['Weighted', scenario.bear.weightedPrice, scenario.base.weightedPrice, scenario.bull.weightedPrice],
  ]
  priceRows.forEach(([label, bear, base, bull]) => {
    const r = ws.addRow([label, bear, base, bull])
    for (let i = 2; i <= 4; i++) r.getCell(i).numFmt = '"$"#,##0.00'
    if (label === 'Weighted') r.font = { bold: true }
  })

  ws.addRow([])
  const eR = ws.addRow(['Expected Value (Probability-Weighted)', null, scenario.expectedPrice, null])
  eR.getCell(1).font = { bold: true }
  eR.getCell(3).font = { bold: true, color: { argb: 'FF1E40AF' } }
  eR.getCell(3).numFmt = '"$"#,##0.00'

  setColumnWidths(ws, [36, 16, 16, 16])
  freezeHeader(ws)
}

// ============================================================================
// About_Company Sheet
// ============================================================================

function buildAboutSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('About_Company')
  const data = run.financialData

  const title = ws.addRow(['About Company'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')
  ws.addRow([])

  const h = ws.addRow(['Field', 'Value'])
  h.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  const rows: Array<[string, CellValue, string?]> = [
    ['Ticker', run.ticker],
    ['Company Name', run.companyName],
    ['Sector', data?.sector ?? 'N/A'],
    ['Industry', data?.industry ?? 'N/A'],
    ['Current Price', run.currentPrice, 'currency'],
    ['Market Cap', data?.marketCap ?? null, 'currency'],
    ['Enterprise Value', data?.enterpriseValue ?? null, 'currency'],
    ['Beta', data?.beta ?? null, 'number'],
    ['52-Week High', data?.fiftyTwoWeekHigh ?? null, 'currency'],
    ['52-Week Low', data?.fiftyTwoWeekLow ?? null, 'currency'],
  ]
  rows.forEach(([label, value, fmt]) => {
    const r = ws.addRow([label, value])
    r.getCell(1).font = { bold: true }
    if (fmt === 'currency') r.getCell(2).numFmt = '"$"#,##0.00'
    if (fmt === 'number') r.getCell(2).numFmt = '0.000'
  })

  ws.addRow([])
  const adR = ws.addRow(['Analysis Date', format(new Date(run.createdAt), 'yyyy-MM-dd HH:mm')])
  adR.getCell(1).font = { bold: true }
  ws.addRow([])

  if (run.assumptions?.investment_thesis) {
    const thHeader = ws.addRow(['Investment Thesis'])
    thHeader.getCell(1).font = { bold: true }
    setFill(thHeader.getCell(1), 'FFE5E7EB')
    const thRow = ws.addRow([run.assumptions.investment_thesis])
    thRow.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    ws.mergeCells(`A${thRow.number}:B${thRow.number}`)
    thRow.height = 80
  }

  if (run.assumptions?.key_risks && run.assumptions.key_risks.length > 0) {
    ws.addRow([])
    const krH = ws.addRow(['Key Risks'])
    krH.getCell(1).font = { bold: true }
    setFill(krH.getCell(1), 'FFE5E7EB')
    run.assumptions.key_risks.forEach(risk => {
      const r = ws.addRow([`• ${risk}`])
      ws.mergeCells(`A${r.number}:B${r.number}`)
      r.getCell(1).alignment = { wrapText: true }
    })
  }

  ws.addRow([])
  ws.addRow(['Generated by', 'AI Stock Valuation Dashboard'])
  ws.addRow(['Note', '[A] markers indicate hardcoded assumptions (editable inputs)'])

  setColumnWidths(ws, [28, 60])
  freezeHeader(ws)
}

// ============================================================================
// Blended Valuation Sheet
// ============================================================================

function buildBlendedValuationSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Blended Valuation')
  const blend = run.blendedOutput
  const cfg = run.valuationConfig

  const title = ws.addRow(['Blended Valuation'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')

  ws.addRow([])

  if (!blend || !cfg) {
    ws.addRow(['Blended valuation not available'])
    setColumnWidths(ws, [30, 18, 14, 18])
    freezeHeader(ws)
    return
  }

  const h = ws.addRow(['Component', 'Implied Price', 'Weight', 'Contribution'])
  h.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  ws.addRow([])
  const dcfSubHeader = ws.addRow(['DCF Sub-Components'])
  dcfSubHeader.getCell(1).font = { bold: true }
  setFill(dcfSubHeader.getCell(1), 'FFF3F4F6')

  const dcfComponents: Array<{ label: string; price: number | null; weightKey: keyof typeof blend.effectiveDCFSubWeights }> = [
    { label: 'DCF (Blended 40/60)', price: blend.dcfBlendedPrice, weightKey: 'blended' },
    { label: 'DCF (Exit Multiple)', price: blend.dcfExitOnlyPrice, weightKey: 'exitOnly' },
    { label: 'DCF (Gordon Growth)', price: blend.dcfGordonOnlyPrice, weightKey: 'gordonOnly' },
  ]
  for (const comp of dcfComponents) {
    const w = blend.effectiveDCFSubWeights[comp.weightKey]
    const contribution = comp.price !== null ? comp.price * w : null
    const r = ws.addRow([comp.label, comp.price, w, contribution])
    r.getCell(2).numFmt = '"$"#,##0.00'
    r.getCell(3).numFmt = '0%'
    r.getCell(4).numFmt = '"$"#,##0.00'
  }
  const combinedDCF = ws.addRow(['Combined DCF', blend.combinedDCFPrice, null, null])
  combinedDCF.font = { bold: true }
  combinedDCF.getCell(2).numFmt = '"$"#,##0.00'

  ws.addRow([])
  const modelHeader = ws.addRow(['Model Blend'])
  modelHeader.getCell(1).font = { bold: true }
  setFill(modelHeader.getCell(1), 'FFF3F4F6')

  const modelComponents: Array<{ label: string; price: number | null; weightKey: keyof typeof blend.effectiveModelWeights }> = [
    { label: 'DCF', price: blend.combinedDCFPrice, weightKey: 'dcf' },
    { label: 'Comps', price: blend.compsPrice, weightKey: 'comps' },
    { label: 'DDM', price: blend.ddmPrice, weightKey: 'ddm' },
  ]
  for (const comp of modelComponents) {
    const w = blend.effectiveModelWeights[comp.weightKey]
    const contribution = comp.price !== null ? comp.price * w : null
    const r = ws.addRow([comp.label, comp.price, w, contribution])
    r.getCell(2).numFmt = '"$"#,##0.00'
    r.getCell(3).numFmt = '0%'
    r.getCell(4).numFmt = '"$"#,##0.00'
  }
  ws.addRow([])
  const finalR = ws.addRow(['FINAL PRICE TARGET', blend.finalPrice, 1.0, blend.finalPrice])
  finalR.font = { bold: true, size: 12 }
  finalR.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } }
  finalR.getCell(4).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } }
  finalR.eachCell(cell => setFill(cell, 'FFDBEAFE'))
  finalR.getCell(2).numFmt = '"$"#,##0.00'
  finalR.getCell(3).numFmt = '0%'
  finalR.getCell(4).numFmt = '"$"#,##0.00'

  setColumnWidths(ws, [30, 18, 14, 18])
  freezeHeader(ws)
}

// ============================================================================
// Sources & Methodology Sheet
// ============================================================================

function buildSourcesSheet(wb: ExcelJS.Workbook, run: ValuationRun): void {
  const ws = wb.addWorksheet('Sources_Methodology')
  const assumptionRows: AssumptionExportRow[] = []

  if (run.assumptions) {
    collectAssumptionRows('wacc', run.assumptions.wacc, assumptionRows)
    collectAssumptionRows('dcf', run.assumptions.dcf, assumptionRows)
    collectAssumptionRows('ddm', run.assumptions.ddm, assumptionRows)
    collectAssumptionRows('comps', run.assumptions.comps, assumptionRows)
    collectAssumptionRows('scenarios', run.assumptions.scenarios, assumptionRows)
  }

  const confidenceSummary = assumptionRows.reduce(
    (summary, row) => {
      if (row.confidence === 'high') summary.high += 1
      if (row.confidence === 'medium') summary.medium += 1
      if (row.confidence === 'low') summary.low += 1
      return summary
    },
    { high: 0, medium: 0, low: 0 },
  )

  const title = ws.addRow(['Sources & Methodology'])
  title.getCell(1).font = { bold: true, size: 14 }
  setFill(title.getCell(1), 'FFE5E7EB')

  ws.addRow([])

  const dsHeader = ws.addRow(['DATA SOURCES'])
  dsHeader.getCell(1).font = { bold: true }
  setFill(dsHeader.getCell(1), 'FFF3F4F6')

  const ds: Array<[string, string]> = [
    ['Financial data', 'yfinance + FRED (fetched automatically via API)'],
    ['Economic data', 'Federal Reserve Economic Data (FRED)'],
    ['Industry benchmarks', 'Damodaran Online Datasets'],
    ['Assumptions', 'AI-generated by Claude / user overrides'],
  ]
  ds.forEach(([k, v]) => ws.addRow([k, v]))

  ws.addRow([])
  const methHeader = ws.addRow(['METHODOLOGY'])
  methHeader.getCell(1).font = { bold: true }
  setFill(methHeader.getCell(1), 'FFF3F4F6')

  const cfg = run.valuationConfig
  const tvLabel = cfg?.dcfConfig.terminalValueMethod === TerminalValueMethod.ExitMultipleOnly ? 'Exit Multiple only'
    : cfg?.dcfConfig.terminalValueMethod === TerminalValueMethod.GordonGrowthOnly ? 'Gordon Growth only'
    : 'Dual terminal value (Gordon 40% + Exit Multiple 60%)'
  const cfLabel = cfg?.dcfConfig.cashFlowBasis === CashFlowBasis.FCFE ? 'FCFE (equity cash flow, discounted at ke)' : 'FCFF (unlevered, discounted at WACC)'
  const discLabel = cfg?.dcfConfig.discountingConvention === DiscountingConvention.MidPeriod ? 'Mid-year convention' : 'End-of-period'

  ws.addRow(['DCF', `5-year ${cfLabel} projection, ${tvLabel}, ${discLabel}`])
  ws.addRow(['DDM', 'Two-stage model when dividend history and payout criteria are met'])
  ws.addRow(['Comps', 'Peer median EV/EBITDA, P/E, EV/Sales, and P/B with configurable weights'])
  ws.addRow(['Scenarios', 'Bear/Base/Bull cases with probability-weighted expected value'])

  if (cfg) {
    ws.addRow([])
    const vcH = ws.addRow(['VALUATION CONFIGURATION'])
    vcH.getCell(1).font = { bold: true }
    setFill(vcH.getCell(1), 'FFF3F4F6')

    ws.addRow(['Terminal Value Method', tvLabel])
    ws.addRow(['Cash Flow Basis', cfLabel])
    ws.addRow(['Discounting Convention', discLabel])

    ws.addRow([])
    const bwH = ws.addRow(['BLEND WEIGHTS'])
    bwH.getCell(1).font = { bold: true }
    setFill(bwH.getCell(1), 'FFF3F4F6')

    ws.addRow(['DCF Sub-Weights', `Blended: ${Math.round(cfg.dcfSubWeights.blended * 100)}%, Exit: ${Math.round(cfg.dcfSubWeights.exitOnly * 100)}%, Gordon: ${Math.round(cfg.dcfSubWeights.gordonOnly * 100)}%`])
    ws.addRow(['Model Weights', `DCF: ${Math.round(cfg.modelWeights.dcf * 100)}%, Comps: ${Math.round(cfg.modelWeights.comps * 100)}%, DDM: ${Math.round(cfg.modelWeights.ddm * 100)}%`])
    if (run.blendedOutput?.finalPrice !== null && run.blendedOutput?.finalPrice !== undefined) {
      const fp = ws.addRow(['Final Price Target', run.blendedOutput.finalPrice])
      fp.getCell(1).font = { bold: true }
      fp.getCell(2).numFmt = '"$"#,##0.00'
      fp.getCell(2).font = { bold: true, color: { argb: 'FF1E40AF' } }
    }
  }

  ws.addRow([])
  const adH = ws.addRow(['ASSUMPTION DETAIL'])
  adH.getCell(1).font = { bold: true }
  setFill(adH.getCell(1), 'FFF3F4F6')

  const ah = ws.addRow(['Assumption', 'Value', 'Source', 'Confidence', 'Rationale'])
  ah.eachCell(cell => { cell.font = { bold: true }; setFill(cell, 'FFD1D5DB') })

  assumptionRows.forEach(row => {
    ws.addRow([
      row.label,
      typeof row.value === 'boolean' ? (row.value ? 'True' : 'False') : row.value,
      row.source,
      row.confidence,
      row.rationale,
    ])
  })

  ws.addRow([])
  const csH = ws.addRow(['CONFIDENCE SUMMARY'])
  csH.getCell(1).font = { bold: true }
  setFill(csH.getCell(1), 'FFF3F4F6')

  ws.addRow(['High', confidenceSummary.high])
  ws.addRow(['Medium', confidenceSummary.medium])
  ws.addRow(['Low', confidenceSummary.low])

  ws.addRow([])
  ws.addRow(['Analysis Date', format(new Date(run.createdAt), 'yyyy-MM-dd HH:mm')])
  ws.addRow(['Version', 'valuation-dashboard'])

  setColumnWidths(ws, [32, 20, 26, 14, 50])
  freezeHeader(ws)
}

// ============================================================================
// Main export function
// ============================================================================

function triggerDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Builds the ExcelJS workbook in memory. Exported for testing.
 */
export async function buildWorkbook(run: ValuationRun): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AI Stock Valuation Dashboard'
  wb.created = new Date(run.createdAt)

  // Cover sheet is FIRST
  buildCoverSheet(wb, run)
  buildSensitivityAnalysisSheet(wb, run)
  buildWaccBuildUpSheet(wb, run)
  buildFinancialStatementForecastSheet(wb, run)
  buildDCFSheet(wb, run)
  buildDDMSheet(wb, run)
  buildRelativeValuationSheet(wb, run)
  buildBlendedValuationSheet(wb, run)
  buildScenarioSheet(wb, run)
  buildAboutSheet(wb, run)
  buildSourcesSheet(wb, run)

  return wb
}

export async function exportToExcel(run: ValuationRun): Promise<void> {
  const wb = await buildWorkbook(run)
  const dateStr = format(new Date(run.createdAt), 'yyyyMMdd')
  const filename = `${run.ticker}_Valuation_${dateStr}.xlsx`
  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(buffer as ArrayBuffer, filename)
}
