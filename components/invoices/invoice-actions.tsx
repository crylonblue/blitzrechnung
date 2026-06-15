'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SendHorizontal, Ban, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { Invoice } from '@/types'
import SendInvoiceModal from './send-invoice-modal'

// Primary post-finalize actions for the invoice detail page — the same Send /
// Storno actions the invoice drawer offers, so both surfaces behave the same.
export default function InvoiceActions({
  invoice,
  hasCancellation,
}: {
  invoice: Invoice
  hasCancellation: boolean
}) {
  const router = useRouter()
  const [showSend, setShowSend] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const isCancellation = (invoice as { invoice_type?: string }).invoice_type === 'cancellation'
  const canBeSent = invoice.status !== 'cancelled' && !isCancellation
  const canBeCancelled =
    invoice.status !== 'draft' &&
    invoice.status !== 'cancelled' &&
    !isCancellation &&
    !hasCancellation

  const handleCancel = async () => {
    const ok = window.confirm(
      `Möchten Sie wirklich eine Stornorechnung für ${invoice.invoice_number} erstellen?\n\nDie Originalrechnung wird als "storniert" markiert.`
    )
    if (!ok) return
    setIsCancelling(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.details || 'Fehler beim Erstellen der Stornorechnung')
      toast.success(`Stornorechnung ${data.cancellationInvoice.invoice_number} erstellt`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler beim Erstellen der Stornorechnung')
    } finally {
      setIsCancelling(false)
    }
  }

  if (!canBeSent && !canBeCancelled) return null

  return (
    <div className="flex flex-wrap gap-3">
      {canBeSent && (
        <Button onClick={() => setShowSend(true)}>
          <SendHorizontal className="h-4 w-4 mr-2" />
          Per E-Mail versenden
        </Button>
      )}
      {canBeCancelled && (
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={isCancelling}
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          {isCancelling ? <LoaderCircle className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
          Rechnung stornieren
        </Button>
      )}
      <SendInvoiceModal
        invoice={invoice}
        isOpen={showSend}
        onClose={() => setShowSend(false)}
        onSent={() => router.refresh()}
      />
    </div>
  )
}
