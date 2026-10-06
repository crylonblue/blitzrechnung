'use client'

import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { useContactEditDrawer } from '@/contexts/contact-edit-drawer-context'
import ContactImportButton from './contact-import-button'

export default function ContactsEmptyState() {
  const { openDrawer } = useContactEditDrawer()

  return (
    <div className="card card-subtle p-12 text-center">
      <p className="text-secondary">Noch keine Kontakte vorhanden.</p>
      <p className="mt-2 text-sm text-meta">
        Kontakte können auch beim Erstellen einer Rechnung angelegt werden.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <ContactImportButton existingContacts={[]} />
        <Button
          onClick={() => openDrawer(null)}
          className="text-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ersten Kontakt erstellen
        </Button>
      </div>
    </div>
  )
}
