import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadFromS3 } from '@/lib/s3'
import { sendEmail, getDefaultFromEmail } from '@/lib/postmark'
import { textToHtml } from '@/lib/email-templates'
import { EmailSettings } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Check if user has access to this invoice's company
  const { data: companyUser } = await supabase
    .from('company_users')
    .select('id, role')
    .eq('user_id', user.id)
    .eq('company_id', invoice.company_id)
    .single()

  if (!companyUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Validate invoice status - can't send drafts
  if (invoice.status === 'draft') {
    return NextResponse.json(
      { error: 'Entwürfe können nicht versendet werden. Bitte finalisieren Sie die Rechnung zuerst.' },
      { status: 400 }
    )
  }

  // Get company with email settings
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', invoice.company_id)
    .single()

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }

  // Parse request body
  const body = await request.json()
  const { recipient_email, subject, body: emailBody } = body

  if (!recipient_email) {
    return NextResponse.json({ error: 'Empfänger-E-Mail ist erforderlich' }, { status: 400 })
  }

  if (!subject) {
    return NextResponse.json({ error: 'Betreff ist erforderlich' }, { status: 400 })
  }

  const emailSettings = (company.email_settings as EmailSettings) || { mode: 'default' }

  try {
    // Determine from address based on email settings
    let fromEmail: string
    let fromName: string | undefined

    if (
      emailSettings.mode === 'custom_domain' &&
      emailSettings.domain_verified &&
      emailSettings.from_email
    ) {
      // Use custom domain
      fromEmail = emailSettings.from_email
      fromName = emailSettings.from_name
    } else {
      // Use default
      fromEmail = getDefaultFromEmail()
      fromName = company.name
    }

    // Build the "From" header
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail

    // Determine reply-to address
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
        console.log('Downloading PDF from:', pdfUrl)
        const pdfBuffer = await downloadFromS3(pdfUrl)
        attachments.push({
          name: `${invoice.invoice_number || 'Rechnung'}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        })
        console.log('PDF downloaded successfully, size:', pdfBuffer.length)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        console.error('Error downloading PDF:', errorMessage, 'URL:', pdfUrl)
        downloadErrors.push(`PDF: ${errorMessage}`)
      }
    } else {
      console.log('No PDF URL found on invoice')
    }

    // Download and attach XML
    if (invoice.xml_url) {
      try {
        console.log('Downloading XML from:', invoice.xml_url)
        const xmlBuffer = await downloadFromS3(invoice.xml_url)
        attachments.push({
          name: `${invoice.invoice_number || 'Rechnung'}.xml`,
          content: xmlBuffer.toString('base64'),
          contentType: 'application/xml',
        })
        console.log('XML downloaded successfully, size:', xmlBuffer.length)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        console.error('Error downloading XML:', errorMessage, 'URL:', invoice.xml_url)
        downloadErrors.push(`XML: ${errorMessage}`)
      }
    }

    // Validate we have at least the PDF
    if (attachments.length === 0) {
      const detailMessage = downloadErrors.length > 0 
        ? `Fehler beim Laden der Dateien: ${downloadErrors.join(', ')}`
        : 'Keine Dateien zum Anhängen verfügbar. Bitte stellen Sie sicher, dass die Rechnung finalisiert wurde.'
      return NextResponse.json(
        { error: detailMessage },
        { status: 400 }
      )
    }

    // Convert plain text body to HTML
    const htmlBody = textToHtml(emailBody || '')

    // Determine which server token to use
    // Use custom server token if domain is verified, otherwise use default
    const serverToken =
      emailSettings.mode === 'custom_domain' &&
      emailSettings.domain_verified &&
      emailSettings.postmark_server_token
        ? emailSettings.postmark_server_token
        : undefined

    // Send email via Postmark
    await sendEmail({
      from,
      to: recipient_email,
      subject,
      htmlBody,
      textBody: emailBody,
      replyTo,
      attachments,
      serverToken,
    })

    // Update invoice status and recipient email
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'sent',
        recipient_email,
      })
      .eq('id', invoice.id)

    if (updateError) {
      console.error('Error updating invoice status:', updateError)
      // Email was sent, so we return success even if status update fails
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error sending invoice email:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fehler beim Versenden der E-Mail' },
      { status: 500 }
    )
  }
}
