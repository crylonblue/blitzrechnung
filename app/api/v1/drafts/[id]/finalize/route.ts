import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { finalizeInvoice, InvoiceServiceError } from '@/lib/invoice-service'

/**
 * POST /api/v1/drafts/:id/finalize
 * Finalize a draft — generates PDF/XML, uploads to S3, sets status to 'created'.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  try {
    const result = await finalizeInvoice(supabase, { companyId: auth.companyId, userId: auth.userId }, id)
    return json({ data: result.invoice, pdf_url: result.pdfUrl, xml_url: result.xmlUrl })
  } catch (err) {
    if (err instanceof InvoiceServiceError) {
      if (err.status === 404) return notFound('Draft')
      if (err.status === 400) {
        const detail = Array.isArray(err.details) ? `: ${err.details.join(', ')}` : err.details ? `: ${err.details}` : ''
        return badRequest(`${err.message}${detail}`)
      }
      return serverError(err.message)
    }
    console.error('Error finalizing draft:', err)
    return serverError('Internal error')
  }
}
