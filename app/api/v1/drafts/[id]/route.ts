import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../_lib/auth'

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
  const supabase = await createClient()

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

  const supabase = await createClient()

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
    invoice_number,
  } = body

  // Build update object
  const updates: Record<string, any> = {}

  // Handle seller update
  if (seller_contact_id !== undefined) {
    if (seller_contact_id === null || seller_contact_id === 'self') {
      updates.seller_is_self = true
      updates.seller_contact_id = null
      updates.seller_snapshot = null
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
  const effectiveBuyerContactId = buyer_contact_id !== undefined ? buyer_contact_id : customer_id
  if (effectiveBuyerContactId !== undefined) {
    if (effectiveBuyerContactId === null) {
      updates.buyer_is_self = false
      updates.buyer_contact_id = null
      updates.buyer_snapshot = null
    } else if (effectiveBuyerContactId === 'self') {
      updates.buyer_is_self = true
      updates.buyer_contact_id = null
      updates.buyer_snapshot = null
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
    const processedLineItems = (line_items || []).map((item: any) => ({
      id: item.id || crypto.randomUUID(),
      description: item.description || '',
      quantity: item.quantity || 1,
      unit_price: item.unit_price || 0,
      vat_rate: item.vat_rate ?? 19,
      total: (item.quantity || 1) * (item.unit_price || 0),
    }))

    const subtotal = processedLineItems.reduce((sum: number, item: any) => sum + item.total, 0)
    const vatAmount = processedLineItems.reduce(
      (sum: number, item: any) => sum + (item.total * item.vat_rate) / 100,
      0
    )

    updates.line_items = processedLineItems
    updates.subtotal = subtotal
    updates.vat_amount = vatAmount
    updates.total_amount = subtotal + vatAmount
  }

  if (invoice_date !== undefined) updates.invoice_date = invoice_date
  if (due_date !== undefined) updates.due_date = due_date
  if (invoice_number !== undefined) updates.invoice_number = invoice_number

  if (Object.keys(updates).length === 0) {
    return badRequest('No fields to update')
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
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
  const supabase = await createClient()

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

  if (error) {
    return serverError(error.message)
  }

  return json({ success: true })
}
