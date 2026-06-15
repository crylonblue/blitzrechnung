import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { cancelInvoice, InvoiceServiceError } from '@/lib/invoice-service'

/**
 * POST /api/v1/invoices/:id/cancel
 * Creates a cancellation invoice (Stornorechnung) for a finalized invoice.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  try {
    const r = await cancelInvoice(supabase, { companyId: auth.companyId, userId: auth.userId }, id)
    return json({
      data: r.cancellationInvoice,
      pdf_url: r.pdfUrl,
      xml_url: r.xmlUrl,
      original_invoice: { id: r.originalInvoiceId, invoice_number: r.originalInvoiceNumber, status: 'cancelled' },
    })
  } catch (err) {
    if (err instanceof InvoiceServiceError) {
      if (err.status === 404) return notFound('Invoice')
      if (err.status === 400) return badRequest(err.message)
      return serverError(err.message)
    }
    console.error('Error creating cancellation invoice:', err)
    return serverError('Internal error')
  }
}
