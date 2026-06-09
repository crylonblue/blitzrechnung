import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, badRequest, serverError, json } from '../_lib/auth'
import { computeInvoiceTotals, round2 } from '@/lib/invoice-totals'

/**
 * GET /api/v1/drafts
 * List all drafts for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('company_id', auth.companyId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })

  if (error) {
    return serverError(error.message)
  }

  return json({ data, count: data?.length ?? 0 })
}

/**
 * POST /api/v1/drafts
 * Create a new draft
 * 
 * Supports both old API (customer_id) and new API (seller_contact_id, buyer_contact_id)
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  let body: any
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const { 
    // New API fields
    seller_contact_id,
    buyer_contact_id,
    // Legacy field (maps to buyer_contact_id)
    customer_id,
    // Common fields
    line_items,
    invoice_date,
    due_date,
    service_date,
    invoice_number, // For external sellers
  } = body

  const supabase = createServiceRoleClient()

  // Fetch company data (needed for "self" snapshots)
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .eq('id', auth.companyId)
    .single()

  if (companyError || !company) {
    return serverError('Company not found')
  }

  // Determine seller
  const seller_is_self = !seller_contact_id || seller_contact_id === 'self'
  let sellerSnapshot: any = null
  
  if (seller_is_self) {
    // Build snapshot from company data
    const bankDetails = company.bank_details as any
    sellerSnapshot = {
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

    sellerSnapshot = {
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

  // Determine buyer (support legacy customer_id)
  const effectiveBuyerContactId = buyer_contact_id || customer_id
  const buyer_is_self = effectiveBuyerContactId === 'self' || effectiveBuyerContactId === auth.companyId
  let buyerSnapshot: any = null
  
  if (buyer_is_self) {
    // Build snapshot from company data
    buyerSnapshot = {
      name: company.name,
      address: company.address,
      email: company.contact_email || null,
      vat_id: company.vat_id || null,
    }
  } else if (effectiveBuyerContactId) {
    const { data: buyerContact, error: buyerError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', effectiveBuyerContactId)
      .eq('company_id', auth.companyId)
      .single()

    if (buyerError || !buyerContact) {
      return badRequest('Buyer contact not found')
    }

    buyerSnapshot = {
      id: buyerContact.id,
      name: buyerContact.name,
      address: buyerContact.address,
      email: buyerContact.email,
      vat_id: buyerContact.vat_id,
    }
  }

  // Process line items - add IDs and calculate totals via the shared EN 16931
  // calculator, so stored totals match the issued PDF/XRechnung exactly.
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

  const subtotal = totals.netTotal
  const vatAmount = totals.taxAmount
  const totalAmount = totals.grossTotal

  // Set default dates if not provided
  const today = new Date()
  const defaultDueDate = new Date(today)
  defaultDueDate.setDate(defaultDueDate.getDate() + 30)

  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0]
  }

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      company_id: auth.companyId,
      status: 'draft',
      seller_is_self,
      seller_contact_id: seller_is_self ? null : seller_contact_id,
      seller_snapshot: sellerSnapshot,
      buyer_is_self,
      buyer_contact_id: buyer_is_self ? null : effectiveBuyerContactId,
      buyer_snapshot: buyerSnapshot,
      invoice_number: invoice_number || null,
      line_items: processedLineItems,
      invoice_date: invoice_date || formatDate(today),
      due_date: due_date || formatDate(defaultDueDate),
      service_date: service_date || invoice_date || formatDate(today),
      subtotal,
      vat_amount: vatAmount,
      total_amount: totalAmount,
    })
    .select()
    .single()

  if (error) {
    return serverError(error.message)
  }

  return json({ data }, 201)
}
