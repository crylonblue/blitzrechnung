'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'
import DraftEditor from './draft-editor'
import { Invoice } from '@/types'
import { createClient } from '@/lib/supabase/client'

export default function DraftDrawer() {
  const { isOpen, draftId, closeDrawer } = useDraftDrawer()
  const router = useRouter()
  const supabase = createClient()
  const [draft, setDraft] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load draft when drawer opens
  useEffect(() => {
    if (isOpen && draftId) {
      loadDraft(draftId)
    } else if (isOpen && !draftId) {
      createNewDraft()
    }
  }, [isOpen, draftId])

  const loadDraft = async (id: string) => {
    setIsLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message || 'Fehler beim Laden des Entwurfs')
      setIsLoading(false)
      return
    }

    setDraft(data)
    setIsLoading(false)
  }

  const createNewDraft = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Get user's first company
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Nicht angemeldet')
        setIsLoading(false)
        return
      }

      const { data: companyUsers } = await supabase
        .from('company_users')
        .select('company_id')
        .eq('user_id', user.id)
        .limit(1)

      if (!companyUsers || companyUsers.length === 0) {
        setError('Kein Unternehmen gefunden')
        setIsLoading(false)
        return
      }

      const companyId = companyUsers[0].company_id

      // Calculate default dates
      const today = new Date()
      const dueDate = new Date(today)
      dueDate.setDate(dueDate.getDate() + 30) // 30 days from today

      // Format dates as YYYY-MM-DD
      const formatDate = (date: Date): string => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      // Create temporary draft object (not saved to database yet)
      const tempDraft: Invoice = {
        id: '', // Will be set when saved
        company_id: companyId,
        status: 'draft',
        line_items: [],
        seller_is_self: true,
        seller_contact_id: null,
        seller_snapshot: null,
        buyer_is_self: false,
        buyer_contact_id: null,
        buyer_snapshot: null,
        invoice_date: formatDate(today),
        due_date: formatDate(dueDate),
        subtotal: 0,
        vat_amount: 0,
        total_amount: 0,
        invoice_number: null,
        invoice_file_reference: null,
        pdf_url: null,
        xml_url: null,
        recipient_email: null,
        finalized_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      setDraft(tempDraft)
      setIsLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen')
      setIsLoading(false)
    }
  }

  // handleFinalize is now handled in DraftEditor itself

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent 
        side="right" 
        className="w-full overflow-hidden p-0 bg-background flex flex-col"
        style={{ maxWidth: '42rem', backgroundColor: 'rgb(245, 245, 245)' }}
        onClose={closeDrawer}
      >
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-secondary">Lädt...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center flex-1">
            <div className="message-error">{error}</div>
          </div>
        ) : draft ? (
          <DraftEditor draft={draft} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

