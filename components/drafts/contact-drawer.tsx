'use client'

import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useContactDrawer } from '@/contexts/contact-drawer-context'
import ContactForm from './contact-form'
import { PartySnapshot } from '@/types'

interface ContactDrawerProps {
  companyId: string
  onSelect: (contact: PartySnapshot) => void
}

export default function ContactDrawer({ companyId, onSelect }: ContactDrawerProps) {
  const { isOpen, closeDrawer } = useContactDrawer()

  const handleSave = (contact: PartySnapshot) => {
    onSelect(contact)
    closeDrawer()
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent 
        side="right" 
        className="w-full overflow-hidden p-0 bg-background flex flex-col"
        style={{ maxWidth: '42rem', backgroundColor: 'rgb(245, 245, 245)' }}
        onClose={closeDrawer}
      >
        <ContactForm 
          companyId={companyId}
          onSave={handleSave}
          onCancel={closeDrawer}
        />
      </SheetContent>
    </Sheet>
  )
}
