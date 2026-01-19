import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { downloadFromS3 } from '@/lib/s3'
import { sendEmail, getDefaultFromEmail } from '@/lib/postmark'
import { textToHtml, generateEmailSubject, generateEmailBody } from '@/lib/email-templates'
import { EmailSettings, CustomerSnapshot } from '@/types'

/**
 * POST /api/v1/invoices/:id/send
 * Send invoice via email
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  // Get the invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (invoiceError || !invoice) {
    return notFound('Invoice')
  }

  // Validate invoice status - can't send drafts
  if (invoice.status === 'draft') {
    return badRequest('Entwürfe können nicht versendet werden. Bitte finalisieren Sie die Rechnung zuerst.')
  }

  // Get company with email settings
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', auth.companyId)
    .single()

  if (!company) {
    return notFound('Company')
  }

  // Parse request body
  let body: { recipient_email?: string; subject?: string; body?: string }
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const customerSnapshot = invoice.customer_snapshot as unknown as CustomerSnapshot | null
  const emailSettings = (company.email_settings as EmailSettings) || { mode: 'default' }
  const language = (invoice.language as 'de' | 'en') || 'de'

  // Determine recipient email
  const recipientEmail = body.recipient_email || invoice.recipient_email || customerSnapshot?.email
  if (!recipientEmail) {
    return badRequest('recipient_email ist erforderlich')
  }

  // Generate subject and body from templates if not provided
  const emailSubject = body.subject || (customerSnapshot 
    ? generateEmailSubject(emailSettings.invoice_email_subject, invoice, customerSnapshot, language)
    : `Rechnung ${invoice.invoice_number || ''}`)
  
  const emailBody = body.body || (customerSnapshot
    ? generateEmailBody(emailSettings.invoice_email_body, invoice, customerSnapshot, language)
    : '')

  try {
    // Determine from address based on email settings
    let fromEmail: string
    let fromName: string | undefined

    if (
      emailSettings.mode === 'custom_domain' &&
      emailSettings.domain_verified &&
      emailSettings.from_email
    ) {
      fromEmail = emailSettings.from_email
      fromName = emailSettings.from_name
    } else {
      fromEmail = getDefaultFromEmail()
      fromName = company.name
    }

    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail

    const replyTo = emailSettings.reply_to_email
      ? emailSettings.reply_to_name
        ? `${emailSettings.reply_to_name} <${emailSettings.reply_to_email}>`
        : emailSettings.reply_to_email
      : undefined

    // Prepare attachments
    const attachments: Array<{ name: string; content: string; contentType: string }> = []
    const downloadErrors: string[] = []

    // Download and attach PDF
    const pdfUrl = invoice.pdf_url || invoice.invoice_file_reference
    if (pdfUrl) {
      try {
        const pdfBuffer = await downloadFromS3(pdfUrl)
        attachments.push({
          name: `${invoice.invoice_number || 'Rechnung'}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        downloadErrors.push(`PDF: ${errorMessage}`)
      }
    }

    // Download and attach XML
    if (invoice.xml_url) {
      try {
        const xmlBuffer = await downloadFromS3(invoice.xml_url)
        attachments.push({
          name: `${invoice.invoice_number || 'Rechnung'}.xml`,
          content: xmlBuffer.toString('base64'),
          contentType: 'application/xml',
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        downloadErrors.push(`XML: ${errorMessage}`)
      }
    }

    // Validate we have at least the PDF
    if (attachments.length === 0) {
      const detailMessage = downloadErrors.length > 0 
        ? `Fehler beim Laden der Dateien: ${downloadErrors.join(', ')}`
        : 'Keine Dateien zum Anhängen verfügbar. Bitte stellen Sie sicher, dass die Rechnung finalisiert wurde.'
      return badRequest(detailMessage)
    }

    // Convert plain text body to HTML
    const htmlBody = textToHtml(emailBody || '')

    // Send email via Postmark
    await sendEmail({
      from,
      to: recipientEmail,
      subject: emailSubject,
      htmlBody,
      textBody: emailBody,
      replyTo,
      attachments,
    })

    // Update invoice status and recipient email
    await supabase
      .from('invoices')
      .update({
        status: 'sent',
        recipient_email: recipientEmail,
      })
      .eq('id', invoice.id)

    return json({ success: true, message: 'Rechnung wurde versendet' })
  } catch (err) {
    console.error('Error sending invoice email:', err)
    return serverError(err instanceof Error ? err.message : 'Fehler beim Versenden der E-Mail')
  }
}
