import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { sendInvoice, InvoiceServiceError } from '@/lib/invoice-service'

/**
 * POST /api/v1/invoices/:id/send — send the invoice via email.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  let body: { recipient_email?: string; subject?: string; body?: string }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  try {
    await sendInvoice(
      supabase,
      { companyId: auth.companyId, userId: auth.userId },
      id,
      { recipientEmail: body.recipient_email, subject: body.subject, body: body.body }
    )
    return json({ success: true, message: 'Rechnung wurde versendet' })
  } catch (err) {
    if (err instanceof InvoiceServiceError) {
      if (err.status === 404) return notFound('Invoice')
      if (err.status === 400) return badRequest(err.message)
      return serverError(err.message)
    }
    console.error('Error sending invoice email:', err)
    return serverError('Fehler beim Versenden der E-Mail')
  }
}
