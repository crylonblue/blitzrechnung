import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, requireApiAccess, unauthorized, notFound, badRequest, serverError, json } from '../../_lib/auth'

/**
 * GET /api/v1/products/:id
 * Get a single product
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const { id } = await params
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (error || !data) {
    return notFound('Product')
  }

  return json({ data })
}

/**
 * PATCH /api/v1/products/:id
 * Update a product
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const { id } = await params

  let body: {
    name?: string
    description?: string
    unit?: string
    unit_price?: number
    default_vat_rate?: number
  }

  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const supabase = createServiceRoleClient()

  // First check if product exists and belongs to company
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (!existing) {
    return notFound('Product')
  }

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {}
  
  if (body.name !== undefined) {
    if (body.name.trim() === '') {
      return badRequest('name cannot be empty')
    }
    updates.name = body.name.trim()
  }
  
  if (body.description !== undefined) {
    updates.description = body.description?.trim() || null
  }
  
  if (body.unit !== undefined) {
    updates.unit = body.unit
  }
  
  if (body.unit_price !== undefined) {
    updates.unit_price = body.unit_price
  }
  
  if (body.default_vat_rate !== undefined) {
    updates.default_vat_rate = body.default_vat_rate
  }

  if (Object.keys(updates).length === 0) {
    return badRequest('No fields to update')
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('products')
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
 * DELETE /api/v1/products/:id
 * Delete a product
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const { id } = await params
  const supabase = createServiceRoleClient()

  // First check if product exists and belongs to company
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .single()

  if (!existing) {
    return notFound('Product')
  }

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) {
    return serverError(error.message)
  }

  return json({ success: true })
}
