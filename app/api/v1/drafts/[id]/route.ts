import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../_lib/auth'
import { computeInvoiceTotals, round2 } from '@/lib/invoice-totals'

/**
 * GET /api/v1/drafts/:id
 * Get a single draft
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .single()

  if (error || !data) {
    return notFound('Draft')
  }

  return json({ data })
}

/**
 * PATCH /api/v1/drafts/:id
 * Update a draft
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params

  let body: any
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const supabase = createServiceRoleClient()

  // First check if draft exists and belongs to company
  const { data: existing } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .single()

  if (!existing) {
    return notFound('Draft')
  }

  const { 
    seller_contact_id,
    buyer_contact_id,
    customer_id, // Legacy support
    line_items,
    invoice_date,
    due_date,
    service_date,
    invoice_number,
  } = body

  // Build update object
  const updates: Record<string, any> = {}

  // Check if we need company data (for "self" snapshots)
  const effectiveBuyerContactId = buyer_contact_id !== undefined ? buyer_contact_id : customer_id
  const needsCompanyData = 
    (seller_contact_id !== undefined && (seller_contact_id === null || seller_contact_id === 'self')) ||
    (effectiveBuyerContactId === 'self')

  let company: any = null
  if (needsCompanyData) {
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', auth.companyId)
      .single()

    if (companyError || !companyData) {
      return serverError('Company not found')
    }
    company = companyData
  }

  // Handle seller update
  if (seller_contact_id !== undefined) {
    if (seller_contact_id === null || seller_contact_id === 'self') {
      // Build snapshot from company data
      const bankDetails = company.bank_details as any
      updates.seller_is_self = true
      updates.seller_contact_id = null
      updates.seller_snapshot = {
        name: company.name,
        address: company.address,
        email: company.contact_email || null,
        vat_id: company.vat_id || null,
        tax_id: company.tax_id || null,
        invoice_number_prefix: company.invoice_number_prefix || null,
        bank_details: bankDetails ? {
          bank_name: bankDetails.bank_name,
          iban: bankDetails.iban,
          bic: bankDetails.bic,
          account_holder: bankDetails.account_holder,
        } : null,
        contact: (company.contact_name || company.contact_phone || company.contact_email) ? {
          name: company.contact_name || null,
          phone: company.contact_phone || null,
          email: company.contact_email || null,
        } : null,
      }
    } else {
      const { data: sellerContact, error: sellerError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', seller_contact_id)
        .eq('company_id', auth.companyId)
        .single()

      if (sellerError || !sellerContact) {
        return badRequest('Seller contact not found')
      }

      updates.seller_is_self = false
      updates.seller_contact_id = seller_contact_id
      updates.seller_snapshot = {
        id: sellerContact.id,
        name: sellerContact.name,
        address: sellerContact.address,
        email: sellerContact.email,
        vat_id: sellerContact.vat_id,
        invoice_number_prefix: sellerContact.invoice_number_prefix,
        tax_id: sellerContact.tax_id,
        bank_details: sellerContact.bank_details,
      }
    }
  }

  // Handle buyer update (support legacy customer_id)
  if (effectiveBuyerContactId !== undefined) {
    if (effectiveBuyerContactId === null) {
      updates.buyer_is_self = false
      updates.buyer_contact_id = null
      updates.buyer_snapshot = null
    } else if (effectiveBuyerContactId === 'self') {
      // Build snapshot from company data
      updates.buyer_is_self = true
      updates.buyer_contact_id = null
      updates.buyer_snapshot = {
        name: company.name,
        address: company.address,
        email: company.contact_email || null,
        vat_id: company.vat_id || null,
      }
    } else {
      const { data: buyerContact, error: buyerError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', effectiveBuyerContactId)
        .eq('company_id', auth.companyId)
        .single()

      if (buyerError || !buyerContact) {
        return badRequest('Buyer contact not found')
      }

      updates.buyer_is_self = false
      updates.buyer_contact_id = effectiveBuyerContactId
      updates.buyer_snapshot = {
        id: buyerContact.id,
        name: buyerContact.name,
        address: buyerContact.address,
        email: buyerContact.email,
        vat_id: buyerContact.vat_id,
      }
    }
  }

  // Handle line items update
  if (line_items !== undefined) {
    const rawItems = (line_items || []) as any[]
    const totals = computeInvoiceTotals(
      rawItems.map((item) => ({
        quantity: item.quantity || 1,
        unitPrice: item.unit_price || 0,
        vatRate: item.vat_rate ?? 19,
        taxCategory: item.tax_category ?? undefined,
        exemptionReason: item.exemption_reason ?? undefined,
      }))
    )
    const processedLineItems = rawItems.map((item, idx) => {
      const vatRate = item.vat_rate ?? 19
      const total = totals.lineNets[idx]
      return {
        id: item.id || crypto.randomUUID(),
        product_id: item.product_id || null,
        description: item.description || '',
        quantity: item.quantity || 1,
        unit: item.unit || 'piece',
        unit_price: item.unit_price || 0,
        vat_rate: vatRate,
        total,
        vat_amount: round2((total * vatRate) / 100),
        tax_category: item.tax_category ?? null,
        exemption_reason: item.exemption_reason ?? null,
      }
    })

    updates.line_items = processedLineItems
    updates.subtotal = totals.netTotal
    updates.vat_amount = totals.taxAmount
    updates.total_amount = totals.grossTotal
  }

  if (invoice_date !== undefined) updates.invoice_date = invoice_date
  if (due_date !== undefined) updates.due_date = due_date
  if (service_date !== undefined) updates.service_date = service_date
  if (invoice_number !== undefined) updates.invoice_number = invoice_number

  if (Object.keys(updates).length === 0) {
    return badRequest('No fields to update')
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .select()
    .single()

  if (error) {
    return serverError(error.message)
  }

  return json({ data })
}

/**
 * DELETE /api/v1/drafts/:id
 * Delete a draft
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = createServiceRoleClient()

  // First check if draft exists and belongs to company
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .single()

  if (!existing) {
    return notFound('Draft')
  }

  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')

  if (error) {
    return serverError(error.message)
  }

  return json({ success: true })
}
