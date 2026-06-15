import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { finalizeInvoice, assertCompanyMembership, InvoiceServiceError } from '@/lib/invoice-service'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { invoiceId } = await request.json()
    if (!invoiceId) return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 })

    const { data: inv } = await supabase.from('invoices').select('company_id').eq('id', invoiceId).single()
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    await assertCompanyMembership(supabase, user.id, inv.company_id)

    const result = await finalizeInvoice(supabase, { companyId: inv.company_id, userId: user.id }, invoiceId)
    return NextResponse.json({
      success: true,
      invoice_number: result.invoice.invoice_number,
      pdfUrl: result.pdfUrl,
      xmlUrl: result.xmlUrl,
    })
  } catch (err) {
    if (err instanceof InvoiceServiceError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status })
    }
    console.error('Error finalizing invoice:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
