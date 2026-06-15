'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface NewDraftClientProps {
  companyId: string
}

export default function NewDraftClient({ companyId }: NewDraftClientProps) {
  const router = useRouter()
  const supabase = createClient()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createDraft = async () => {
    setIsCreating(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('invoices')
      .insert({
        company_id: companyId,
        status: 'draft',
        line_items: [],
        subtotal: 0,
        vat_amount: 0,
        total_amount: 0,
      })
      .select('id')
      .single()

    if (insertError || !data) {
      setError(insertError?.message || 'Entwurf konnte nicht erstellt werden.')
      setIsCreating(false)
      return
    }

    router.push(`/drafts/${data.id}`)
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="space-y-6">
        <div>
          <h1 className="text-headline">Neuer Entwurf</h1>
          <p className="mt-2 text-meta">Erstellen Sie einen leeren Rechnungsentwurf.</p>
        </div>

        {error && <div className="message-error">{error}</div>}

        <Button onClick={createDraft} disabled={isCreating}>
          {isCreating && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
          Entwurf erstellen
        </Button>
      </div>
    </div>
  )
}
