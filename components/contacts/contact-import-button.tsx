'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ContactImportDialog from './contact-import-dialog'

interface ContactImportButtonProps {
  existingContacts: { name: string; zip: string }[]
}

export default function ContactImportButton({ existingContacts }: ContactImportButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="text-sm">
        <Upload className="h-4 w-4 mr-2" />
        Importieren
      </Button>
      <ContactImportDialog open={open} onOpenChange={setOpen} existingContacts={existingContacts} />
    </>
  )
}
