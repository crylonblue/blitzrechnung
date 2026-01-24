import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { generateXRechnungXML } from '@/lib/zugferd-generator'
import { uploadToS3 } from '@/lib/s3'
import { mapDBInvoiceToPDFInvoice } from '@/lib/invoice-mapper'
import { validateXRechnungInvoice } from '@/lib/schema'
import type { Invoice as DBInvoice, PartySnapshot } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { invoiceId } = body

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 })
    }

    // Fetch the invoice (should be draft status before upload)
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .in('status', ['draft', 'created']) // Accept both draft and created
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Verify user belongs to the invoice's company
    const { data: companyUser } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', invoice.company_id)
      .single()

    if (!companyUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const dbInvoice = invoice as DBInvoice
    const buyerSnapshot = dbInvoice.buyer_snapshot as PartySnapshot | null

    // Validate buyer exists (unless buyer_is_self)
    if (!buyerSnapshot && !dbInvoice.buyer_is_self) {
      return NextResponse.json({ error: 'Buyer snapshot is missing' }, { status: 400 })
    }

    // Validate contact_id constraints before changing status to 'created'
    // These constraints exist in the database (migration 020_invoice_constraints.sql)
    if (!dbInvoice.buyer_is_self && !dbInvoice.buyer_contact_id) {
      return NextResponse.json({ 
        error: 'Empfänger fehlt', 
        details: 'Bitte wählen Sie einen Empfänger aus bevor Sie die Rechnung finalisieren.'
      }, { status: 400 })
    }
    if (!dbInvoice.seller_is_self && !dbInvoice.seller_contact_id) {
      return NextResponse.json({ 
        error: 'Absender fehlt', 
        details: 'Bitte wählen Sie einen Absender aus bevor Sie die Rechnung finalisieren.'
      }, { status: 400 })
    }

    // Get company for issuer data and logo
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', dbInvoice.company_id)
      .single()

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
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
        // Legal info for PDF footer
        court: (company as any).court || undefined,
        register_number: (company as any).register_number || undefined,
        managing_director: (company as any).managing_director || undefined,
      }
    } else {
      // Use the seller_snapshot from the invoice (external contact)
      // The snapshot should already contain legal info if the contact has it
      const existingSellerSnapshot = dbInvoice.seller_snapshot as PartySnapshot | null
      if (!existingSellerSnapshot) {
        return NextResponse.json({ error: 'Seller snapshot is missing' }, { status: 400 })
      }
      sellerSnapshot = existingSellerSnapshot
    }

    // Build final buyer snapshot (use company if buyer_is_self)
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

    // Get intro/outro text - use invoice-specific values if set, otherwise fallback to company defaults
    const introText = dbInvoice.intro_text || company.default_intro_text || null
    const outroText = dbInvoice.outro_text || company.default_outro_text || null
    
    // Get buyer reference from invoice
    const buyerReference = (dbInvoice as any).buyer_reference || null

    // Map database invoice to PDF invoice format
    // Legal info is now included in the sellerSnapshot (works for both company and contact sellers)
    // Only include company logo when the company is the seller
    const pdfInvoice = mapDBInvoiceToPDFInvoice(
      dbInvoice,
      sellerSnapshot,
      finalBuyerSnapshot,
      dbInvoice.seller_is_self ? company?.logo_url : null,
      introText,
      outroText,
      buyerReference
    )

    // Validate invoice for XRechnung compliance before generating
    const validation = validateXRechnungInvoice(pdfInvoice)
    if (!validation.valid) {
      return NextResponse.json(
        { 
          error: 'XRechnung-Validierung fehlgeschlagen',
          details: validation.errors,
        },
        { status: 400 }
      )
    }
    
    // Log warnings but don't block finalization
    if (validation.warnings.length > 0) {
      console.log('XRechnung validation warnings:', validation.warnings)
    }

    // Generate PDF with embedded ZUGFeRD
    // Pass the language from the invoice (defaults to 'de' if not set)
    const language = (dbInvoice.language as 'de' | 'en') || 'de'
    const pdfBuffer = await generateInvoicePDF(pdfInvoice, language)

    // Generate XRechnung XML
    const xmlString = await generateXRechnungXML(pdfInvoice)

    // Upload PDF to S3
    let pdfUrl: string
    let xmlUrl: string
    
    try {
      pdfUrl = await uploadToS3(
        user.id,
        invoiceId,
        `${dbInvoice.invoice_number || invoiceId}.pdf`,
        Buffer.from(pdfBuffer),
        'application/pdf'
      )

      // Upload XML to S3
      xmlUrl = await uploadToS3(
        user.id,
        invoiceId,
        `${dbInvoice.invoice_number || invoiceId}.xml`,
        Buffer.from(xmlString, 'utf-8'),
        'application/xml'
      )
    } catch (s3Error) {
      console.error('S3 upload error:', s3Error)
      return NextResponse.json(
        { 
          error: s3Error instanceof Error ? s3Error.message : 'Failed to upload files to S3',
          details: 'Please check your S3 configuration in .env.local'
        },
        { status: 500 }
      )
    }

    // Update invoice with file URLs and set status to 'created' after successful upload
    // Also save final snapshots, intro/outro text, buyer_reference, and set recipient_email from buyer if available
    const updateData: Record<string, unknown> = {
      status: 'created', // Set to created only after successful upload
      seller_snapshot: sellerSnapshot,
      buyer_snapshot: finalBuyerSnapshot,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
      // Snapshot the text fields at time of finalization
      intro_text: introText,
      outro_text: outroText,
      buyer_reference: buyerReference,
    }
    
    // Set recipient email from buyer snapshot if not already set
    if (!dbInvoice.recipient_email && finalBuyerSnapshot?.email) {
      updateData.recipient_email = finalBuyerSnapshot.email
    }

    const { error: updateError } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)

    if (updateError) {
      console.error('Invoice update error:', updateError)
      return NextResponse.json({ 
        error: 'Failed to update invoice', 
        details: updateError.message,
        code: updateError.code 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      pdfUrl,
      xmlUrl,
    })
  } catch (error) {
    console.error('Error finalizing invoice:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
