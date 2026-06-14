'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Download, LoaderCircle } from 'lucide-react'

function currentMonthRange() {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
}

export default function DatevExportButton() {
  const def = currentMonthRange()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(def.from)
  const [to, setTo] = useState(def.to)
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/datev-export?from=${from}&to=${to}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Export fehlgeschlagen')
      }
      const bookings = Number(res.headers.get('X-Datev-Bookings') || '0')
      const skipped = Number(res.headers.get('X-Datev-Skipped') || '0')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `EXTF_Buchungsstapel_${from}_${to}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setOpen(false)
      if (bookings === 0) {
        toast.warning('Keine Buchungssätze in diesem Zeitraum.')
      } else {
        toast.success(
          `${bookings} Buchungssätze exportiert.` +
            (skipped ? ` ${skipped} Reverse-Charge-Rechnung(en) übersprungen.` : '')
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Download className="h-4 w-4 mr-2" />
        DATEV-Export
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DATEV-Export</DialogTitle>
            <DialogDescription>
              Buchungsstapel für deinen Steuerberater. Zeitraum nach Rechnungsdatum.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="datev-from">Von</Label>
              <Input id="datev-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="datev-to">Bis</Label>
              <Input id="datev-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleExport} disabled={loading || !from || !to}>
              {loading && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              Exportieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
