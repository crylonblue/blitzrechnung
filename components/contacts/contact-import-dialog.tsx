'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  MAX_IMPORT_ROWS,
  TEMPLATE_CSV,
  guessMapping,
  processRows,
  type ColumnMapping,
  type ImportField,
} from '@/lib/contact-import'

const REQUIRED_FIELDS: ImportField[] = ['name', 'street', 'zip', 'city']
const UNMAPPED = 'none'
const PREVIEW_ROWS = 50

interface ParsedFile {
  fileName: string
  headers: string[]
  rows: unknown[][]
}

interface ContactImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingContacts: { name: string; zip: string }[]
}

// Excel speichert CSV unter Windows meist als Windows-1252, nicht UTF-8. Ohne
// diesen Fallback würden Umlaute zu "�".
function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase()
  let data: unknown[][]

  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    data = await readSheet(file)
  } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const result = Papa.parse<string[]>(decodeText(await file.arrayBuffer()), {
      skipEmptyLines: 'greedy',
    })
    data = result.data
  } else if (name.endsWith('.xls')) {
    throw new Error('Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte als .xlsx oder .csv speichern.')
  } else {
    throw new Error('Bitte eine CSV- oder Excel-Datei (.xlsx) wählen.')
  }

  const [headerRow, ...rows] = data
  if (!headerRow || rows.length === 0) {
    throw new Error('Die Datei enthält keine Daten unterhalb der Kopfzeile.')
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Maximal ${MAX_IMPORT_ROWS} Kontakte pro Import. Bitte die Datei aufteilen.`)
  }

  return {
    fileName: file.name,
    headers: headerRow.map((h, i) => (h === null || h === undefined || h === '' ? `Spalte ${i + 1}` : String(h).trim())),
    rows,
  }
}

function downloadTemplate() {
  // BOM, damit Excel die Datei als UTF-8 öffnet.
  const blob = new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'kontakte-vorlage.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function ContactImportDialog({ open, onOpenChange, existingContacts }: ContactImportDialogProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const results = useMemo(
    () => (parsed && mapping ? processRows(parsed.rows, mapping, existingContacts) : []),
    [parsed, mapping, existingContacts]
  )
  const importable = results.filter((r) => r.errors.length === 0 && !r.duplicate)
  const invalidCount = results.filter((r) => r.errors.length > 0).length
  const duplicateCount = results.filter((r) => r.duplicate).length
  const missingRequired = mapping ? REQUIRED_FIELDS.filter((f) => mapping[f] === null) : []

  const reset = () => {
    setParsed(null)
    setMapping(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleOpenChange = (next: boolean) => {
    if (isImporting) return
    if (!next) reset()
    onOpenChange(next)
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setIsParsing(true)
    setError(null)
    try {
      const result = await parseFile(file)
      setParsed(result)
      setMapping(guessMapping(result.headers))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.')
    } finally {
      setIsParsing(false)
    }
  }

  const handleImport = async () => {
    setIsImporting(true)
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: importable.map((r) => r.contact) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Import fehlgeschlagen')

      toast.success(`${data.created} Kontakt${data.created === 1 ? '' : 'e'} importiert`, {
        description: data.duplicates ? `${data.duplicates} bereits vorhandene übersprungen.` : undefined,
      })
      reset()
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={parsed ? 'sm:max-w-4xl max-h-[90vh] overflow-y-auto' : undefined}>
        <DialogHeader>
          <DialogTitle>Kontakte importieren</DialogTitle>
          <DialogDescription>
            {parsed
              ? `${parsed.fileName}: Prüfen Sie die Zuordnung der Spalten.`
              : 'Laden Sie eine CSV- oder Excel-Datei mit einer Kopfzeile hoch.'}
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-4">
            <div
              className={`relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer ${
                isDragging ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-300'
              } ${isParsing ? 'pointer-events-none opacity-60' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                handleFile(e.dataTransfer.files[0])
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.xlsx"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <div className="flex flex-col items-center gap-3 text-center">
                {isParsing ? (
                  <LoaderCircle className="h-8 w-8 text-zinc-400 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-8 w-8 text-zinc-400" />
                )}
                <p className="text-sm text-secondary">Datei auswählen oder hierher ziehen</p>
                <p className="text-xs text-meta">.csv oder .xlsx, bis zu {MAX_IMPORT_ROWS} Kontakte</p>
              </div>
            </div>

            {error && <div className="message-error">{error}</div>}

            <p className="text-xs text-meta">
              Benötigt werden Name, Straße mit Hausnummer, PLZ und Ort. Land, E-Mail und USt-IdNr. sind
              optional, ohne Land wird Deutschland angenommen.{' '}
              <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 underline">
                <Download className="h-3 w-3" />
                Vorlage herunterladen
              </button>
            </p>
          </div>
        ) : (
          mapping && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs text-meta">
                      {IMPORT_FIELD_LABELS[field]}
                      {REQUIRED_FIELDS.includes(field) && ' *'}
                    </label>
                    <Select
                      value={mapping[field] === null ? UNMAPPED : String(mapping[field])}
                      onValueChange={(value) =>
                        setMapping({ ...mapping, [field]: value === UNMAPPED ? null : Number(value) })
                      }
                    >
                      <SelectTrigger className="w-full text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNMAPPED}>
                          {field === 'streetnumber' ? '– aus Straße übernehmen –' : '– nicht importieren –'}
                        </SelectItem>
                        {parsed.headers.map((header, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {missingRequired.length > 0 ? (
                <div className="message-error">
                  Bitte ordnen Sie zu: {missingRequired.map((f) => IMPORT_FIELD_LABELS[f]).join(', ')}
                </div>
              ) : (
                <>
                  <p className="text-sm text-secondary">
                    <strong>{importable.length}</strong> von {results.length} Kontakten werden importiert.
                    {invalidCount > 0 && ` ${invalidCount} mit Fehlern werden übersprungen.`}
                    {duplicateCount > 0 && ` ${duplicateCount} sind bereits vorhanden.`}
                  </p>

                  <div className="overflow-x-auto rounded-lg border border-zinc-200">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 text-left text-xs text-meta">
                        <tr>
                          <th className="px-3 py-2">Zeile</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Adresse</th>
                          <th className="px-3 py-2">E-Mail</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.slice(0, PREVIEW_ROWS).map((r) => (
                          <tr key={r.line} className="border-t border-zinc-100 align-top">
                            <td className="px-3 py-2 text-meta">{r.line}</td>
                            <td className="px-3 py-2">{r.contact.name || '–'}</td>
                            <td className="px-3 py-2">
                              {[r.contact.address.street, r.contact.address.streetnumber].filter(Boolean).join(' ')}
                              <br />
                              {[r.contact.address.zip, r.contact.address.city].filter(Boolean).join(' ')}
                              {r.contact.address.country && r.contact.address.country !== 'DE' && `, ${r.contact.address.country}`}
                            </td>
                            <td className="px-3 py-2">{r.contact.email || '–'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.errors.length > 0 ? (
                                <span className="text-red-600">{r.errors.join(', ')}</span>
                              ) : r.duplicate ? (
                                <span className="text-meta">Bereits vorhanden</span>
                              ) : (
                                <span className="text-green-700">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {results.length > PREVIEW_ROWS && (
                    <p className="text-xs text-meta">
                      Vorschau zeigt die ersten {PREVIEW_ROWS} von {results.length} Zeilen.
                    </p>
                  )}
                </>
              )}
            </div>
          )
        )}

        {parsed && (
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={isImporting}>
              Andere Datei
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || missingRequired.length > 0 || importable.length === 0}
            >
              {isImporting && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              {importable.length} Kontakt{importable.length === 1 ? '' : 'e'} importieren
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
