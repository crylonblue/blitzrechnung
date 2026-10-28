import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * POST /api/team/joined
 * Wird nach der ersten Anmeldung per Link oder Code aufgerufen und nimmt dem
 * Nutzer das „eingeladen“ ab. Betrifft nur das eigene Konto.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await createServiceRoleClient().from('company_users').update({ invite_pending: false }).eq('user_id', user.id)
  return NextResponse.json({ success: true })
}
