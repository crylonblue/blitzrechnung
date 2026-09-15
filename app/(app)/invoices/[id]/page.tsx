import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getAppSession } from '@/lib/app-session'
import InvoiceView from '@/components/invoices/invoice-view'
import StatusUpdater from '@/components/invoices/status-updater'
import InvoiceActions from '@/components/invoices/invoice-actions'
import { getStatusLabel, getStatusClass } from '@/lib/invoice-utils'

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const { companyIds } = await getAppSession()
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !invoice) {
    redirect('/invoices')
  }

  // Zugriffsprüfung gegen die bereits geladenen Zugehörigkeiten.
  if (!companyIds.includes(invoice.company_id)) {
    redirect('/invoices')
  }

  // Firmendaten und die Frage nach einer vorhandenen Stornorechnung hängen
  // nicht voneinander ab — parallel statt nacheinander.
  const [companyResult, cancellationResult] = await Promise.all([
    supabase.from('companies').select('*').eq('id', invoice.company_id).single(),
    supabase
      .from('invoices')
      .select('id')
      .eq('cancelled_invoice_id', invoice.id)
      .maybeSingle(),
  ])

  const company = companyResult.data
  const existingCancellation = cancellationResult.data

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-headline">
            {invoice.invoice_number || 'Rechnung'}
          </h1>
          <span className={`${getStatusClass(invoice.status)} mt-2 inline-block`}>
            {getStatusLabel(invoice.status)}
          </span>
        </div>
        <StatusUpdater invoice={invoice} />
      </div>

      <div className="mb-8">
        <InvoiceActions invoice={invoice} hasCancellation={!!existingCancellation} />
      </div>

      <InvoiceView invoice={invoice} company={company} />
    </div>
  )
}

