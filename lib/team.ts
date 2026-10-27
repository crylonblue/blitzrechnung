import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { loadInvoiceScope, type InvoiceScope } from '@/lib/access'

/**
 * Gemeinsame Grundlage der Team-Routen (`app/api/team/*`).
 *
 * Alle Schreibzugriffe laufen mit dem Dienstschlüssel: Teammitglieder sehen
 * einander per RLS nicht (user_profiles ist nur für den Besitzer lesbar), und
 * company_users hat bewusst keine Schreib-Policy. Deshalb prüft jede Route hier
 * ausdrücklich, wer fragt und was er darf.
 */

export class TeamError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TeamError'
    this.status = status
  }
}

export interface TeamContext {
  userId: string
  email: string
  companyId: string
  scope: InvoiceScope
  /** Dienstschlüssel — nur nach bestandener Rechteprüfung der Route benutzen. */
  db: ReturnType<typeof createServiceRoleClient>
}

/** Angemeldeter Nutzer samt Rolle in seiner primären Firma. */
export async function getTeamContext(): Promise<TeamContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new TeamError(401, 'Unauthorized')

  // Dieselbe „primäre Firma“ wie in getAppSession: die erste Zugehörigkeit.
  const { data: memberships } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
  const companyId = memberships?.[0]?.company_id
  if (!companyId) throw new TeamError(403, 'Keine Firma gefunden')

  const db = createServiceRoleClient()
  const scope = await loadInvoiceScope(db, user.id, companyId)
  if (!scope) throw new TeamError(403, 'Keine Firma gefunden')

  return { userId: user.id, email: user.email ?? '', companyId, scope, db }
}

export function teamErrorResponse(err: unknown): NextResponse {
  if (err instanceof TeamError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('team route failed', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim())
}
