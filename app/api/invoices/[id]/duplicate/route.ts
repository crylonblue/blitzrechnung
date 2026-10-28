import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { duplicateInvoice, assertCompanyMembership, InvoiceServiceError } from '@/lib/invoice-service'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: inv } = await supabase.from('invoices').select('company_id').eq('id', id).single()
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    await assertCompanyMembership(supabase, user.id, inv.company_id)

    const r = await duplicateInvoice(supabase, { companyId: inv.company_id, userId: user.id }, id)
    return NextResponse.json({ success: true, draft: { id: r.draft.id }, sourceNumber: r.sourceNumber })
  } catch (err) {
    if (err instanceof InvoiceServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('Error duplicating invoice:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
