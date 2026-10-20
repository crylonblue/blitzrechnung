'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Invoice } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getStatusLabel, getStatusClass } from '@/lib/invoice-utils'

interface StatusUpdaterProps {
  invoice: Invoice
}

type InvoiceStatus = 'sent' | 'reminded' | 'paid' | 'cancelled'

export default function StatusUpdater({ invoice }: StatusUpdaterProps) {
  const router = useRouter()
  const supabase = createClient()
  const [isUpdating, setIsUpdating] = useState(false)

  const handleStatusChange = async (newStatus: InvoiceStatus) => {
    setIsUpdating(true)
    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoice.id)

    if (error) {
      alert('Fehler beim Aktualisieren des Status: ' + error.message)
    } else {
      router.refresh()
    }
    setIsUpdating(false)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* Zurück zu Versendet — nur aus 'paid'. Eine stornierte Rechnung bleibt
          storniert: Zu ihr existiert bereits eine Stornorechnung mit eigener
          fortlaufender Nummer. Setzte man sie wieder auf 'sent' oder 'paid',
          stünde diese Stornorechnung ohne Bezug da — ein Zustand, den die v1-API
          aus gutem Grund verweigert ("Cancelled invoices cannot be modified"). */}
      {invoice.status === 'paid' && (
        <Button
          onClick={() => handleStatusChange('sent')}
          disabled={isUpdating}
          variant="outline"
        >
          {isUpdating && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
          Zurück zu Versendet
        </Button>
      )}

      {/* Versenden - nur von created */}
      {invoice.status === 'created' && (
        <Button
          onClick={() => handleStatusChange('sent')}
          disabled={isUpdating}
          variant="outline"
        >
          {isUpdating && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
          Als versendet markieren
        </Button>
      )}

      {/* Mahnen - nur von sent */}
      {invoice.status === 'sent' && (
        <Button
          onClick={() => handleStatusChange('reminded')}
          disabled={isUpdating}
          variant="outline"
        >
          {isUpdating && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
          Als gemahnt markieren
        </Button>
      )}

      {/* Bezahlt — aus jedem offenen Zustand, aber nicht aus 'cancelled'
          (siehe oben). */}
      {['created', 'sent', 'reminded'].includes(invoice.status) && (
        <Button
          onClick={() => handleStatusChange('paid')}
          disabled={isUpdating}
        >
          {isUpdating && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
          Als bezahlt markieren
        </Button>
      )}

      {/* Stornieren erfolgt ausschließlich über den echten Storno-Flow
          (erzeugt eine Stornorechnung) im Rechnungs-Drawer, nicht durch
          einfaches Setzen des Status. */}
    </div>
  )
}

