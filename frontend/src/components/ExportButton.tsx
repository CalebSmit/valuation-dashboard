import { useState, useRef, useEffect } from 'react'

interface ExportButtonProps {
  disabled: boolean
  onExportExcel: () => void
  onExportPDF: () => void | Promise<void>
}

export function ExportButton({ disabled, onExportExcel, onExportPDF }: ExportButtonProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    btnRef.current?.setAttribute('aria-expanded', String(open))
  }, [open])

  const handleExportExcel = () => {
    setOpen(false)
    onExportExcel()
  }

  const handleExportPDF = async () => {
    setOpen(false)
    await onExportPDF()
  }

  return (
    <div className="export-menu">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        aria-haspopup="menu"
        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider btn-export"
      >
        Export
      </button>
      {open && !disabled && (
        <div className="export-menu-list card" role="menu">
          <button type="button" role="menuitem" className="export-menu-item" onClick={handleExportExcel}>
            Export Excel
          </button>
          <button type="button" role="menuitem" className="export-menu-item" onClick={handleExportPDF}>
            Export PDF
          </button>
        </div>
      )}
    </div>
  )
}
