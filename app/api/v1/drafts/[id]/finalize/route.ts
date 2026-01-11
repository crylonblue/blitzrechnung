import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../../_lib/auth'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { generateXRechnungXML } from '@/lib/zugferd-generator'
import { uploadToS3 } from '@/lib/s3'
import { mapDBInvoiceToPDFInvoice } from '@/lib/invoice-mapper'
import { validateXRechnungInvoice } from '@/lib/schema'
import type { Invoice as DBInvoice, PartySnapshot } from '@/types'

// Type for the atomic invoice number RPC result
interface InvoiceNumberResult {
  next_number: number
  formatted_number: string
}

/**
 * POST /api/v1/drafts/:id/finalize
 * Finalize a draft - generates PDF/XML, uploads to S3, sets status to 'created'
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = await createClient()

  // Fetch the draft
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .single()

  if (invoiceError || !invoice) {
    return notFound('Draft')
  }

  const dbInvoice = invoice as DBInvoice
  const buyerSnapshot = dbInvoice.buyer_snapshot as PartySnapshot | null

  // Validate buyer exists
  if (!buyerSnapshot && !dbInvoice.buyer_is_self) {
    return badRequest('Buyer (Empfänger) is required before finalizing')
  }

  // Get company for logo URL and invoice number generation
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', auth.companyId)
    .single()

  if (!company) {
    return serverError('Company not found')
  }

  // Build seller snapshot based on seller_is_self flag
  let sellerSnapshot: PartySnapshot
  
  if (dbInvoice.seller_is_self) {
    // Build from company data
    const bankDetails = company.bank_details as any
    sellerSnapshot = {
      name: company.name,
      address: company.address as any,
      vat_id: company.vat_id || undefined,
      tax_id: company.tax_id || undefined,
      bank_details: bankDetails ? {
        bank_name: bankDetails.bank_name,
        iban: bankDetails.iban,
        bic: bankDetails.bic,
        account_holder: bankDetails.account_holder,
      } : undefined,
      // XRechnung BR-DE-2: Seller Contact
      contact: (company.contact_name || company.contact_phone || company.contact_email) ? {
        name: company.contact_name || undefined,
        phone: company.contact_phone || undefined,
        email: company.contact_email || undefined,
      } : undefined,
    }
  } else {
    // Use the seller_snapshot from the invoice (external contact)
    const existingSellerSnapshot = dbInvoice.seller_snapshot as PartySnapshot | null
    if (!existingSellerSnapshot) {
      return badRequest('Seller (Absender) is required before finalizing')
    }
    sellerSnapshot = existingSellerSnapshot
  }

  // Build buyer snapshot for PDF (use company if buyer_is_self)
  let finalBuyerSnapshot: PartySnapshot
  if (dbInvoice.buyer_is_self) {
    finalBuyerSnapshot = {
      name: company.name,
      address: company.address as any,
      vat_id: company.vat_id || undefined,
    }
  } else {
    finalBuyerSnapshot = buyerSnapshot!
  }

  // Generate invoice number if not set (using atomic function)
  let invoiceNumber = dbInvoice.invoice_number
  if (!invoiceNumber) {
    if (dbInvoice.seller_is_self) {
      // Use company's invoice number sequence (atomic)
      const { data: numberResult, error: numberError } = await supabase
        .rpc('get_next_invoice_number', {
          p_seller_type: 'company',
          p_seller_id: auth.companyId,
          p_prefix: company.invoice_number_prefix || 'INV'
        })
        .single() as { data: InvoiceNumberResult | null, error: any }

      if (numberError || !numberResult) {
        console.error('Error generating invoice number:', numberError)
        return serverError('Failed to generate invoice number')
      }

      invoiceNumber = numberResult.formatted_number
    } else {
      // Use external seller's invoice number sequence (atomic)
      const sellerContact = dbInvoice.seller_snapshot as PartySnapshot | null
      if (sellerContact?.invoice_number_prefix && dbInvoice.seller_contact_id) {
        const { data: numberResult, error: numberError } = await supabase
          .rpc('get_next_invoice_number', {
            p_seller_type: 'contact',
            p_seller_id: dbInvoice.seller_contact_id,
            p_prefix: sellerContact.invoice_number_prefix
          })
          .single() as { data: InvoiceNumberResult | null, error: any }

        if (numberError || !numberResult) {
          console.error('Error generating invoice number:', numberError)
          return serverError('Failed to generate invoice number')
        }

        invoiceNumber = numberResult.formatted_number
      } else {
        return badRequest('Invoice number is required for external sellers without a number prefix')
      }
    }

    // Update the invoice with the number
    await supabase
      .from('invoices')
      .update({ invoice_number: invoiceNumber })
      .eq('id', id)
    
    // Update local reference
    dbInvoice.invoice_number = invoiceNumber
  }

  // Map database invoice to PDF invoice format
  const pdfInvoice = mapDBInvoiceToPDFInvoice(
    dbInvoice,
    sellerSnapshot,
    finalBuyerSnapshot,
    company?.logo_url
  )

  // Validate invoice for XRechnung compliance before generating
  const validation = validateXRechnungInvoice(pdfInvoice)
  if (!validation.valid) {
    return badRequest(`XRechnung-Validierung fehlgeschlagen: ${validation.errors.join(', ')}`)
  }
  
  // Log warnings but don't block finalization
  if (validation.warnings.length > 0) {
    console.log('XRechnung validation warnings:', validation.warnings)
  }

  // Generate PDF with embedded ZUGFeRD
  let pdfBuffer: Uint8Array
  let xmlString: string
  try {
    pdfBuffer = await generateInvoicePDF(pdfInvoice)
    xmlString = await generateXRechnungXML(pdfInvoice)
  } catch (err) {
    console.error('Error generating PDF/XML:', err)
    return serverError('Failed to generate invoice documents')
  }

  // Upload to S3
  let pdfUrl: string
  let xmlUrl: string
  try {
    pdfUrl = await uploadToS3(
      auth.userId,
      id,
      `${invoiceNumber}.pdf`,
      Buffer.from(pdfBuffer),
      'application/pdf'
    )

    xmlUrl = await uploadToS3(
      auth.userId,
      id,
      `${invoiceNumber}.xml`,
      Buffer.from(xmlString, 'utf-8'),
      'application/xml'
    )
  } catch (s3Error) {
    console.error('S3 upload error:', s3Error)
    return serverError('Failed to upload files')
  }

  // Update invoice status and file URLs
  // Also save final snapshots
  const { data: updatedInvoice, error: updateError } = await supabase
    .from('invoices')
    .update({
      status: 'created',
      seller_snapshot: sellerSnapshot,
      buyer_snapshot: finalBuyerSnapshot,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
      finalized_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    return serverError('Failed to update invoice status')
  }

  return json({
    data: updatedInvoice,
    pdf_url: pdfUrl,
    xml_url: xmlUrl,
  })
}
