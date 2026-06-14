import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InvoiceView from '@/components/invoices/invoice-view'
import StatusUpdater from '@/components/invoices/status-updater'
import InvoiceActions from '@/components/invoices/invoice-actions'
import { getStatusLabel, getStatusClass } from '@/lib/invoice-utils'

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !invoice) {
    redirect('/invoices')
  }

  // Check if user has access
  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('company_id', invoice.company_id)
    .single()

  if (!companyUsers) {
    redirect('/invoices')
  }

  // Get company data
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', invoice.company_id)
    .single()

  // Does a Stornorechnung already exist for this invoice?
  const { data: existingCancellation } = await supabase
    .from('invoices')
    .select('id')
    .eq('cancelled_invoice_id', invoice.id)
    .maybeSingle()

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

