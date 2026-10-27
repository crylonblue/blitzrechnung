import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { validateApiKey, requireApiAccess, unauthorized, serverError, json, scopeInvoices } from '../_lib/auth'

/**
 * GET /api/v1/invoices
 * List all finalized invoices (non-draft) for the company
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth) return unauthorized()
  const denied = requireApiAccess(auth)
  if (denied) return denied

  const supabase = createServiceRoleClient()

  // Get query params for filtering
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = scopeInvoices(supabase.from('invoices').select('*'), auth)
    .eq('company_id', auth.companyId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })

  // Filter by status if provided
  if (status && ['created', 'sent', 'reminded', 'paid', 'cancelled'].includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return serverError(error.message)
  }

  return json({ data, count: data?.length ?? 0 })
}
