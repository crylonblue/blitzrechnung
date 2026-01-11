import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import InvoicesTable from '@/components/invoices/invoices-table'

export default async function InvoicesPage() {
  const supabase = await createClient()
  
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

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('*')
    .in('company_id', companyIds)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="message-error">
          Fehler beim Laden der Rechnungen: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-12">
        <h1 className="text-headline">Rechnungen</h1>
        <p className="mt-2 text-meta">
          Alle fertiggestellten Rechnungen
        </p>
      </div>

      {invoices && invoices.length === 0 ? (
        <div className="card card-subtle p-16 text-center">
          <p className="text-secondary">Noch keine Rechnungen vorhanden.</p>
          <Link
            href="/drafts/new"
            className="mt-4 inline-block text-sm font-medium"
            style={{ color: 'var(--accent)' }}
          >
            Erste Rechnung erstellen →
          </Link>
        </div>
      ) : (
        <InvoicesTable invoices={invoices || []} companyNames={Object.fromEntries(companyMap)} />
      )}
    </div>
  )
}

