import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, badRequest, serverError, json } from '../_lib/auth'

/**
 * GET /api/v1/contacts
 * List all contacts for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('company_id', auth.companyId)
    .order('name')

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

  const supabase = await createClient()

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
