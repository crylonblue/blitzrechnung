import { createClient } from '@/lib/supabase/server'
import { getAppSession } from '@/lib/app-session'
import { INVOICE_LIST_COLUMNS } from '@/lib/list-columns'
import Link from 'next/link'
import InvoicesTable from '@/components/invoices/invoices-table'
import DatevExportButton from '@/components/invoices/datev-export-button'

export default async function InvoicesPage() {
  // Nutzer und Firmen kommen aus dem pro Request gecachten Resolver — das
  // Layout hat sie ohnehin schon aufgelöst, der Aufruf kostet hier nichts mehr.
  const { companyIds, companyNames } = await getAppSession()
  const supabase = await createClient()

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(INVOICE_LIST_COLUMNS)
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
      <div className="mb-12 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline">Rechnungen</h1>
          <p className="mt-2 text-meta">
            Alle fertiggestellten Rechnungen
          </p>
        </div>
        <DatevExportButton />
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
        <InvoicesTable invoices={(invoices as never) || []} companyNames={companyNames} />
      )}
    </div>
  )
}
