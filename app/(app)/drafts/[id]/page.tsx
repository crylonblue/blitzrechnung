import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getAppSession } from '@/lib/app-session'
import DraftEditor from '@/components/drafts/draft-editor'

export default async function DraftPage({ params }: { params: { id: string } }) {
  const { companyIds } = await getAppSession()
  const supabase = await createClient()

  const { data: draft, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !draft) {
    redirect('/drafts')
  }

  // Zugriffsprüfung gegen die bereits geladenen Zugehörigkeiten — gleiche
  // Bedingung wie vorher, nur ohne zusätzlichen Roundtrip.
  if (!companyIds.includes(draft.company_id)) {
    redirect('/drafts')
  }

  // Only allow editing if status is draft
  if (draft.status !== 'draft') {
    redirect(`/invoices/${draft.id}`)
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <DraftEditor draft={draft} />
    </div>
  )
}

