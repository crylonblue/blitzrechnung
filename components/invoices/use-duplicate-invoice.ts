'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'
import { useInvoiceDrawer } from '@/contexts/invoice-drawer-context'
import { useAccess } from '@/contexts/access-context'

/**
 * Rechnung duplizieren — für alle Stellen, an denen es einen Knopf dafür gibt.
 *
 * Der Server legt den Entwurf an; hier folgt, was der Nutzer davon sieht: Die
 * Rechnungsschublade geht zu (zwei Schubladen übereinander gibt es nicht) und
 * die Entwurfsschublade öffnet sich mit der Kopie. Dort stehen die neuen Daten
 * zur Kontrolle bereit, bevor irgendetwas finalisiert wird.
 */
export function useDuplicateInvoice() {
  const router = useRouter()
  const { openDrawer: openDraft } = useDraftDrawer()
  const { closeDrawer: closeInvoice } = useInvoiceDrawer()
  // Die Buchhaltung darf nichts anlegen; für sie gibt es den Knopf nicht.
  const { canWriteInvoices: canDuplicate } = useAccess()
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  const duplicate = async (invoiceId: string) => {
    setDuplicatingId(invoiceId)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/duplicate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fehler beim Duplizieren')
      toast.success(
        data.sourceNumber ? `Entwurf aus ${data.sourceNumber} erstellt` : 'Entwurf erstellt',
        { description: 'Datum und Zahlungsziel sind auf heute gesetzt.' }
      )
      closeInvoice()
      openDraft(data.draft.id)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler beim Duplizieren')
    } finally {
      setDuplicatingId(null)
    }
  }

  return { duplicate, duplicatingId, canDuplicate }
}
