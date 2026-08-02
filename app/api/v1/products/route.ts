import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, requireApiAccess, unauthorized, badRequest, serverError, json } from '../_lib/auth'

/**
 * GET /api/v1/products
 * List all products for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const supabase = createServiceRoleClient()

  const { data, error, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('company_id', auth.companyId)
    .order('name', { ascending: true })

  if (error) {
    return serverError(error.message)
  }

  return json({ data: data || [], count: count || 0 })
}

/**
 * POST /api/v1/products
 * Create a new product
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

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

  // Validate required fields
  if (!body.name || body.name.trim() === '') {
    return badRequest('name is required')
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('products')
    .insert({
      company_id: auth.companyId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      unit: body.unit || 'piece',
      unit_price: body.unit_price ?? 0,
      default_vat_rate: body.default_vat_rate ?? 19,
    })
    .select()
    .single()

  if (error) {
    return serverError(error.message)
  }

  return json({ data }, 201)
}
