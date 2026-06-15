import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, unauthorized, notFound, badRequest, serverError, json } from '../../_lib/auth'

const VALID_STATUSES = ['created', 'sent', 'reminded', 'paid', 'cancelled']

/**
 * GET /api/v1/invoices/:id
 * Get a single invoice
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
    .neq('status', 'draft')
    .single()

  if (error || !data) {
    return notFound('Invoice')
  }

  return json({ data })
}

/**
 * PATCH /api/v1/invoices/:id
 * Update invoice status
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

  const { status } = body

  if (!status) {
    return badRequest('status is required')
  }

  if (!VALID_STATUSES.includes(status)) {
    return badRequest(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`)
  }

  const supabase = createServiceRoleClient()

  // First check if invoice exists and belongs to company
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, status')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .neq('status', 'draft')
    .single()

  if (!existing) {
    return notFound('Invoice')
  }

  // Cancelled invoices cannot be changed
  if (existing.status === 'cancelled') {
    return badRequest('Cancelled invoices cannot be modified')
  }

  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .neq('status', 'draft')
    .select()
    .single()

  if (error) {
    return serverError(error.message)
  }

  return json({ data })
}
