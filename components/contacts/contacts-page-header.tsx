'use client'

import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useContactEditDrawer } from '@/contexts/contact-edit-drawer-context'

export default function ContactsPageHeader() {
  const { openDrawer } = useContactEditDrawer()

  return (
    <div className="mb-12 flex items-center justify-between">
      <div>
        <h1 className="text-headline">Kontakte</h1>
        <p className="mt-2 text-meta">
          Verwaltung Ihrer Kontakte (Kunden, Lieferanten, Partner)
        </p>
      </div>
      <Button
        onClick={() => openDrawer(null)}
        className="text-sm"
      >
        <Plus className="h-4 w-4 mr-2" />
        Neuer Kontakt
      </Button>
    </div>
  )
}
