import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, badRequest, serverError, json } from '../_lib/auth'

/**
 * GET /api/v1/drafts
 * List all drafts for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const supabase = await createClient()

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
    invoice_number, // For external sellers
  } = body

  const supabase = await createClient()

  // Determine seller
  const seller_is_self = !seller_contact_id
  let sellerSnapshot = null
  
  if (!seller_is_self && seller_contact_id) {
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
  let buyerSnapshot = null
  
  if (!buyer_is_self && effectiveBuyerContactId) {
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

  // Process line items - add IDs and calculate totals
  const processedLineItems = (line_items || []).map((item: any) => ({
    id: item.id || crypto.randomUUID(),
    description: item.description || '',
    quantity: item.quantity || 1,
    unit_price: item.unit_price || 0,
    vat_rate: item.vat_rate ?? 19,
    total: (item.quantity || 1) * (item.unit_price || 0),
  }))

  // Calculate totals
  const subtotal = processedLineItems.reduce((sum: number, item: any) => sum + item.total, 0)
  const vatAmount = processedLineItems.reduce(
    (sum: number, item: any) => sum + (item.total * item.vat_rate) / 100,
    0
  )
  const totalAmount = subtotal + vatAmount

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
