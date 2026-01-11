'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useContactEditDrawer } from '@/contexts/contact-edit-drawer-context'
import ContactEditForm from './contact-edit-form'
import { Contact } from '@/types'
import { createClient } from '@/lib/supabase/client'

export default function ContactEditDrawer() {
  const { isOpen, contactId, closeDrawer } = useContactEditDrawer()
  const router = useRouter()
  const supabase = createClient()
  const [contact, setContact] = useState<Contact | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load contact when drawer opens
  useEffect(() => {
    if (isOpen && contactId) {
      loadContact(contactId)
    } else if (isOpen && !contactId) {
      // For creating new contact, set contact to null
      setContact(null)
      setError(null)
    }
  }, [isOpen, contactId])

  const loadContact = async (id: string) => {
    setIsLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message || 'Fehler beim Laden des Kontakts')
      setIsLoading(false)
      return
    }

    setContact(data)
    setIsLoading(false)
  }

  const handleClose = () => {
    closeDrawer()
    setContact(null)
    setError(null)
    // Delay refresh to ensure state updates are processed
    setTimeout(() => {
      router.refresh()
    }, 100)
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent 
        side="right" 
        className="w-full overflow-hidden p-0 bg-background flex flex-col"
        style={{ maxWidth: '42rem', backgroundColor: 'rgb(245, 245, 245)' }}
        onClose={handleClose}
      >
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-secondary">Lädt...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center flex-1">
            <div className="message-error">{error}</div>
          </div>
        ) : (
          <ContactEditForm contact={contact} onClose={handleClose} />
        )}
      </SheetContent>
    </Sheet>
  )
}
