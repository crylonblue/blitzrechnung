import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, requireApiAccess, unauthorized, notFound, badRequest, json } from '../../../_lib/auth'

/**
 * GET /api/v1/invoices/:id/pdf
 * Get the public URLs for downloading the invoice PDF and XML
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const { id } = await params
  const supabase = createServiceRoleClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, pdf_url, xml_url, invoice_number')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .neq('status', 'draft')
    .single()

  if (error || !invoice) {
    return notFound('Invoice')
  }

  if (!invoice.pdf_url) {
    return badRequest('PDF not available for this invoice')
  }

  return json({
    pdf_url: invoice.pdf_url,
    xml_url: invoice.xml_url || null,
  })
}
