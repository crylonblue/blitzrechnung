import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { mapDBInvoiceToPDFInvoice } from '@/lib/invoice-mapper'
import { computeInvoiceTotals } from '@/lib/invoice-totals'
import type { Invoice as DBInvoice, PartySnapshot, LineItem } from '@/types'

interface PreviewRequest {
  companyId: string
  sellerIsSelf: boolean
  sellerSnapshot: PartySnapshot | null
  buyerIsSelf: boolean
  buyerSnapshot: PartySnapshot | null
  lineItems: LineItem[]
  invoiceDate: string | null
  dueDate: string | null
  serviceDate?: string | null
  language: 'de' | 'en'
  buyerReference?: string
}

/**
 * POST /api/drafts/preview
 * Generate a preview PDF for a draft invoice without saving it
 * Returns the PDF as a binary response
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: PreviewRequest = await request.json()
    const { 
      companyId, 
      sellerIsSelf, 
      sellerSnapshot: providedSellerSnapshot,
      buyerIsSelf,
      buyerSnapshot: providedBuyerSnapshot,
      lineItems, 
      invoiceDate, 
      language,
      buyerReference: providedBuyerReference,
    } = body

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    // Verify user belongs to this company
    const { data: companyUser } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .single()

    if (!companyUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get company data
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single()

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // Build seller snapshot
    let sellerSnapshot: PartySnapshot
    
    if (sellerIsSelf) {
      // Build from company data (including legal info for PDF footer)
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
    } else if (providedSellerSnapshot) {
      // Use provided seller snapshot (from contact - should already include legal info)
      sellerSnapshot = providedSellerSnapshot
    } else {
      return NextResponse.json({ error: 'Seller information is required' }, { status: 400 })
    }

    // Build buyer snapshot
    let buyerSnapshot: PartySnapshot
    
    if (buyerIsSelf) {
      // Build from company data
      buyerSnapshot = {
        name: company.name,
        address: company.address as any,
        vat_id: company.vat_id || undefined,
      }
    } else if (providedBuyerSnapshot) {
      buyerSnapshot = providedBuyerSnapshot
    } else {
      return NextResponse.json({ error: 'Buyer information is required' }, { status: 400 })
    }

    // Calculate totals via the shared EN 16931 calculator (matches PDF/XML)
    const totals = computeInvoiceTotals(
      lineItems.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unit_price,
        vatRate: item.vat_rate ?? 19,
        taxCategory: item.tax_category,
        exemptionReason: item.exemption_reason,
      }))
    )
    const subtotal = totals.netTotal
    const vatAmount = totals.taxAmount
    const totalAmount = totals.grossTotal

    // Get intro/outro text from company settings
    const introText = company.default_intro_text || null
    const outroText = company.default_outro_text || null
    const buyerReference = providedBuyerReference || null

    // Create a mock DB invoice for the mapper
    const mockInvoice: DBInvoice = {
      id: 'preview',
      company_id: companyId,
      status: 'draft',
      invoice_type: 'invoice',
      invoice_number: 'VORSCHAU', // Preview indicator
      invoice_date: invoiceDate || new Date().toISOString().split('T')[0],
      due_date: body.dueDate || null,
      service_date: body.serviceDate || invoiceDate || new Date().toISOString().split('T')[0],
      seller_is_self: sellerIsSelf,
      seller_contact_id: null,
      seller_snapshot: sellerSnapshot as any,
      buyer_is_self: buyerIsSelf,
      buyer_contact_id: null,
      buyer_snapshot: buyerSnapshot as any,
      line_items: lineItems as any,
      subtotal,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      language: language || 'de',
      intro_text: introText,
      outro_text: outroText,
      buyer_reference: buyerReference,
      cancelled_invoice_id: null,
      pdf_url: null,
      xml_url: null,
      invoice_file_reference: null,
      recipient_email: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      finalized_at: null,
    }

    // Map to PDF format - legal info is now in sellerSnapshot
    const pdfInvoice = mapDBInvoiceToPDFInvoice(
      mockInvoice,
      sellerSnapshot,
      buyerSnapshot,
      sellerIsSelf ? company?.logo_url : null,
      introText,
      outroText,
      buyerReference || 'VORSCHAU' // Use provided reference or show preview indicator
    )

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(pdfInvoice, language || 'de')

    // Return PDF as binary response
    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="vorschau.pdf"',
      },
    })
  } catch (error) {
    console.error('Error generating preview:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
