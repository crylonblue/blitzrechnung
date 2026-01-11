import { createClient } from '@/lib/supabase/server'
import DraftsList from '@/components/drafts/drafts-list'
import DraftsTable from '@/components/drafts/drafts-table'

export default async function DraftsPage() {
  const supabase = await createClient()
  
  // Get user's companies
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)

  const companyIds = companyUsers?.map((cu) => cu.company_id) || []

  // Get company data for displaying names
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .in('id', companyIds)

  const companyMap = new Map(companies?.map(c => [c.id, c.name]) || [])

  // Get all drafts for user's companies
  const { data: drafts, error } = await supabase
    .from('invoices')
    .select('*')
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
        <DraftsTable drafts={drafts || []} companyNames={Object.fromEntries(companyMap)} />
      )}
    </div>
  )
}
