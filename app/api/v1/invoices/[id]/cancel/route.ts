import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { generateXRechnungXML } from '@/lib/zugferd-generator'
import { uploadToS3 } from '@/lib/s3'
import { mapDBInvoiceToPDFInvoice } from '@/lib/invoice-mapper'
import type { Invoice as DBInvoice, PartySnapshot, LineItem } from '@/types'

// Type for the atomic cancellation invoice number RPC result
interface CancellationNumberResult {
  next_number: number
  formatted_number: string
}

/**
 * POST /api/v1/invoices/:id/cancel
 * Creates a cancellation invoice (Stornorechnung) for an existing finalized invoice
 * 
 * Returns:
 * - 200: Cancellation invoice created successfully
 * - 400: Invoice cannot be cancelled (draft, already cancelled, or is a cancellation invoice)
 * - 401: Invalid or missing API key
 * - 404: Invoice not found
 * - 500: Server error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  // Fetch the original invoice
  const { data: originalInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (invoiceError || !originalInvoice) {
    return notFound('Invoice')
  }

  const dbInvoice = originalInvoice as DBInvoice

  // Validate invoice can be cancelled
  if (dbInvoice.status === 'draft') {
    return badRequest('Cannot cancel draft invoice. Only finalized invoices can be cancelled.')
  }

  if (dbInvoice.status === 'cancelled') {
    return badRequest('Invoice has already been cancelled.')
  }

  // Check if this invoice is already a cancellation invoice
  if ((dbInvoice as any).invoice_type === 'cancellation') {
    return badRequest('Cannot cancel a cancellation invoice.')
  }

  // Check if a cancellation invoice already exists for this invoice
  const { data: existingCancellation } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('cancelled_invoice_id', id)
    .single()

  if (existingCancellation) {
    return badRequest(`A cancellation invoice (${existingCancellation.invoice_number}) already exists for this invoice.`)
  }

  // Get company for cancellation number generation
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', auth.companyId)
    .single()

  if (!company) {
    return serverError('Company not found')
  }

  // Determine seller type and generate cancellation invoice number
  let cancellationNumber: string
  
  if (dbInvoice.seller_is_self) {
    // Use company's cancellation number sequence (atomic)
    const { data: numberResult, error: numberError } = await supabase
      .rpc('get_next_cancellation_invoice_number', {
        p_seller_type: 'company',
        p_seller_id: auth.companyId,
        p_prefix: (company as any).cancellation_number_prefix || 'ST'
      })
      .single() as { data: CancellationNumberResult | null, error: any }

    if (numberError || !numberResult) {
      console.error('Error generating cancellation number:', numberError)
      return serverError('Failed to generate cancellation invoice number')
    }

    cancellationNumber = numberResult.formatted_number
  } else {
    // Use external seller's cancellation number sequence (atomic)
    if (!dbInvoice.seller_contact_id) {
      return badRequest('Cannot generate cancellation number for external seller without contact ID.')
    }

    const { data: numberResult, error: numberError } = await supabase
      .rpc('get_next_cancellation_invoice_number', {
        p_seller_type: 'contact',
        p_seller_id: dbInvoice.seller_contact_id,
        p_prefix: null // Will use contact's cancellation_number_prefix or default 'ST'
      })
      .single() as { data: CancellationNumberResult | null, error: any }

    if (numberError || !numberResult) {
      console.error('Error generating cancellation number:', numberError)
      return serverError('Failed to generate cancellation invoice number')
    }

    cancellationNumber = numberResult.formatted_number
  }

  // Get original line items and negate amounts
  const originalLineItems = (dbInvoice.line_items as unknown as LineItem[]) || []
  const negatedLineItems = originalLineItems.map(item => ({
    ...item,
    quantity: -Math.abs(item.quantity), // Negate quantity
    total: -Math.abs(item.total), // Negate total
    vat_amount: item.vat_amount ? -Math.abs(item.vat_amount) : undefined,
  }))

  // Calculate negated totals
  const negatedSubtotal = -Math.abs(dbInvoice.subtotal)
  const negatedVatAmount = -Math.abs(dbInvoice.vat_amount)
  const negatedTotalAmount = -Math.abs(dbInvoice.total_amount)

  // Create cancellation invoice record
  const cancellationInvoiceData = {
    company_id: dbInvoice.company_id,
    status: 'created' as const,
    invoice_type: 'cancellation',
    invoice_number: cancellationNumber,
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: dbInvoice.due_date, // Keep same due date
    service_date: dbInvoice.service_date, // Keep same service date
    seller_is_self: dbInvoice.seller_is_self,
    seller_contact_id: dbInvoice.seller_contact_id,
    seller_snapshot: dbInvoice.seller_snapshot,
    buyer_is_self: dbInvoice.buyer_is_self,
    buyer_contact_id: dbInvoice.buyer_contact_id,
    buyer_snapshot: dbInvoice.buyer_snapshot,
    line_items: negatedLineItems,
    subtotal: negatedSubtotal,
    vat_amount: negatedVatAmount,
    total_amount: negatedTotalAmount,
    recipient_email: dbInvoice.recipient_email,
    language: dbInvoice.language,
    intro_text: dbInvoice.intro_text,
    outro_text: dbInvoice.outro_text,
    buyer_reference: dbInvoice.buyer_reference,
    cancelled_invoice_id: id, // Reference to original invoice
    finalized_at: new Date().toISOString(),
  }

  const { data: cancellationInvoice, error: insertError } = await supabase
    .from('invoices')
    .insert(cancellationInvoiceData)
    .select()
    .single()

  if (insertError || !cancellationInvoice) {
    console.error('Error creating cancellation invoice:', insertError)
    return serverError('Failed to create cancellation invoice')
  }

  // Map to PDF invoice format
  const sellerSnapshot = dbInvoice.seller_snapshot as unknown as PartySnapshot
  const buyerSnapshot = dbInvoice.buyer_snapshot as unknown as PartySnapshot
  
  const pdfInvoice = mapDBInvoiceToPDFInvoice(
    cancellationInvoice as DBInvoice,
    sellerSnapshot,
    buyerSnapshot,
    dbInvoice.seller_is_self ? company?.logo_url : null,
    dbInvoice.intro_text,
    dbInvoice.outro_text,
    dbInvoice.buyer_reference
  )

  // Generate PDF and XML with cancellation-specific settings
  const language = (dbInvoice.language as 'de' | 'en') || 'de'
  const cancellationOptions = {
    isCancellation: true,
    originalInvoiceNumber: dbInvoice.invoice_number || undefined,
  }

  let pdfBuffer: Uint8Array
  let xmlString: string
  try {
    pdfBuffer = await generateInvoicePDF(pdfInvoice, language, cancellationOptions)
    xmlString = await generateXRechnungXML(pdfInvoice, cancellationOptions)
  } catch (err) {
    console.error('Error generating cancellation PDF/XML:', err)
    // Delete the cancellation invoice record since we couldn't generate files
    await supabase.from('invoices').delete().eq('id', cancellationInvoice.id)
    return serverError('Failed to generate cancellation invoice documents')
  }

  // Upload to S3
  let pdfUrl: string
  let xmlUrl: string
  try {
    pdfUrl = await uploadToS3(
      auth.userId,
      cancellationInvoice.id,
      `${cancellationNumber}.pdf`,
      Buffer.from(pdfBuffer),
      'application/pdf'
    )

    xmlUrl = await uploadToS3(
      auth.userId,
      cancellationInvoice.id,
      `${cancellationNumber}.xml`,
      Buffer.from(xmlString, 'utf-8'),
      'application/xml'
    )
  } catch (s3Error) {
    console.error('S3 upload error:', s3Error)
    // Delete the cancellation invoice record since we couldn't upload files
    await supabase.from('invoices').delete().eq('id', cancellationInvoice.id)
    return serverError('Failed to upload cancellation invoice files')
  }

  // Update cancellation invoice with file URLs
  const { data: updatedCancellation, error: updateCancellationError } = await supabase
    .from('invoices')
    .update({
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
    })
    .eq('id', cancellationInvoice.id)
    .select()
    .single()

  if (updateCancellationError) {
    console.error('Error updating cancellation invoice:', updateCancellationError)
  }

  // Update original invoice status to 'cancelled'
  const { error: updateOriginalError } = await supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (updateOriginalError) {
    console.error('Error updating original invoice status:', updateOriginalError)
    // Don't fail - the cancellation invoice was created successfully
  }

  return json({
    data: updatedCancellation || cancellationInvoice,
    pdf_url: pdfUrl,
    xml_url: xmlUrl,
    original_invoice: {
      id: id,
      invoice_number: dbInvoice.invoice_number,
      status: 'cancelled',
    },
  })
}
