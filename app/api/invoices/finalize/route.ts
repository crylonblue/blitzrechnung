import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF } from '@/lib/pdf-generator'
import { generateXRechnungXML } from '@/lib/zugferd-generator'
import { uploadToS3 } from '@/lib/s3'
import { mapDBInvoiceToPDFInvoice } from '@/lib/invoice-mapper'
import type { Invoice as DBInvoice, IssuerSnapshot, CustomerSnapshot } from '@/types'

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

    // Fetch the finalized invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('status', 'created')
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
    const issuerSnapshot = (dbInvoice.issuer_snapshot as unknown as IssuerSnapshot) || null
    const customerSnapshot = (dbInvoice.customer_snapshot as unknown as CustomerSnapshot)!

    if (!customerSnapshot) {
      return NextResponse.json({ error: 'Customer snapshot is missing' }, { status: 400 })
    }

    // Get company for logo URL
    const { data: company } = await supabase
      .from('companies')
      .select('logo_url')
      .eq('id', dbInvoice.company_id)
      .single()

    // Map database invoice to PDF invoice format
    const pdfInvoice = mapDBInvoiceToPDFInvoice(
      dbInvoice,
      issuerSnapshot,
      customerSnapshot,
      company?.logo_url
    )

    // Generate PDF with embedded ZUGFeRD
    const pdfBuffer = await generateInvoicePDF(pdfInvoice)

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

    // Update invoice with file URLs
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        pdf_url: pdfUrl,
        xml_url: xmlUrl,
      })
      .eq('id', invoiceId)

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
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

