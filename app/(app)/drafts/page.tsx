import { createClient } from '@/lib/supabase/server'
import { getAppSession } from '@/lib/app-session'
import { DRAFT_LIST_COLUMNS } from '@/lib/list-columns'
import DraftsList from '@/components/drafts/drafts-list'
import DraftsTable from '@/components/drafts/drafts-table'

export default async function DraftsPage() {
  // Nutzer und Firmen kommen aus dem pro Request gecachten Resolver.
  const { companyIds, companyNames } = await getAppSession()
  const supabase = await createClient()

  const { data: drafts, error } = await supabase
    .from('invoices')
    .select(DRAFT_LIST_COLUMNS)
    .in('company_id', companyIds)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="message-error">
          Fehler beim Laden der Entwürfe: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-headline">Entwürfe</h1>
          <p className="mt-2 text-meta">
            Rechnungen vorbereiten und später fertigstellen
          </p>
        </div>
        <DraftsList drafts={[]} />
      </div>

      {drafts && drafts.length === 0 ? (
        <div className="card card-subtle p-16 text-center">
          <p className="text-secondary">Noch keine Entwürfe vorhanden.</p>
          <DraftsList drafts={[]} showEmptyLink />
        </div>
      ) : (
        <DraftsTable drafts={(drafts as never) || []} companyNames={companyNames} />
      )}
    </div>
  )
}
