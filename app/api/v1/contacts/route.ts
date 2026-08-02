import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, requireApiAccess, unauthorized, badRequest, serverError, json } from '../_lib/auth'

/**
 * GET /api/v1/contacts
 * List all contacts for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const supabase = createServiceRoleClient()

  // Get query params for filtering
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')

  let query = supabase
    .from('contacts')
    .select('*')
    .eq('company_id', auth.companyId)

  // Filter by name if search term provided (case-insensitive partial match)
  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  const { data, error } = await query.order('name')

  if (error) {
    return serverError(error.message)
  }

  return json({ data, count: data?.length ?? 0 })
}

/**
 * POST /api/v1/contacts
 * Create a new contact
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

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
    // Seller-specific fields
    invoice_number_prefix,
    tax_id,
    bank_details
  } = body

  if (!name) {
    return badRequest('name is required')
  }

  if (!address || !address.street || !address.city || !address.zip || !address.country) {
    return badRequest('address with street, city, zip, and country is required')
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      company_id: auth.companyId,
      name,
      address,
      email: email || null,
      vat_id: vat_id || null,
      invoice_number_prefix: invoice_number_prefix || null,
      tax_id: tax_id || null,
      bank_details: bank_details || null,
    })
    .select()
    .single()

  if (error) {
    return serverError(error.message)
  }

  return json({ data }, 201)
}
