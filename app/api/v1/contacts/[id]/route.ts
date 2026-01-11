import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../_lib/auth'

/**
 * GET /api/v1/contacts/:id
 * Get a single contact
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
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (error || !data) {
    return notFound('Contact')
  }

  return json({ data })
}

/**
 * PATCH /api/v1/contacts/:id
 * Update a contact
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

  const { 
    name, 
    address, 
    email, 
    vat_id,
    invoice_number_prefix,
    tax_id,
    bank_details
  } = body

  // Build update object with only provided fields
  const updates: Record<string, any> = {}
  if (name !== undefined) updates.name = name
  if (address !== undefined) updates.address = address
  if (email !== undefined) updates.email = email
  if (vat_id !== undefined) updates.vat_id = vat_id
  if (invoice_number_prefix !== undefined) updates.invoice_number_prefix = invoice_number_prefix
  if (tax_id !== undefined) updates.tax_id = tax_id
  if (bank_details !== undefined) updates.bank_details = bank_details

  if (Object.keys(updates).length === 0) {
    return badRequest('No fields to update')
  }

  const supabase = await createClient()

  // First check if contact exists and belongs to company
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (!existing) {
    return notFound('Contact')
  }

  const { data, error } = await supabase
    .from('contacts')
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
 * DELETE /api/v1/contacts/:id
 * Delete a contact
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const { id } = await params
  const supabase = await createClient()

  // First check if contact exists and belongs to company
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (!existing) {
    return notFound('Contact')
  }

  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id)

  if (error) {
    return serverError(error.message)
  }

  return json({ success: true })
}
