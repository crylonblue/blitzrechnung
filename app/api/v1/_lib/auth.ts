import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getBillingState } from '@/lib/billing'
import { loadInvoiceScope, readableDepartmentIds, writableDepartmentIds, type InvoiceScope } from '@/lib/access'

export interface ApiAuth {
  companyId: string
  userId: string
  /** Company has an unexpired trial or a live subscription. */
  entitled: boolean
  /** API access is a Pro feature; trials count as Pro. */
  isPro: boolean
  /**
   * Rolle und Abteilungen des Nutzers, dem der Schlüssel gehört. Die API
   * arbeitet mit dem Dienstschlüssel und umgeht RLS; ein Schlüssel darf also
   * nicht mehr sehen als sein Besitzer in der Oberfläche.
   */
  scope: InvoiceScope
}

/**
 * Validates an API key from the Authorization header
 * Returns company and user info if valid, null otherwise
 */
export async function validateApiKey(request: NextRequest): Promise<ApiAuth | null> {
  const authHeader = request.headers.get('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const apiKey = authHeader.slice(7) // Remove 'Bearer ' prefix
  
  if (!apiKey || !apiKey.startsWith('flx_')) {
    return null
  }

  // Hash the API key using SHA-256
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  const supabase = createServiceRoleClient()

  // Find API key by hash
  const { data: apiKeyRecord, error } = await supabase
    .from('api_keys')
    .select('id, company_id, user_id')
    .eq('key_hash', keyHash)
    .single()

  if (error || !apiKeyRecord) {
    return null
  }

  // Ein Schlüssel überlebt seinen Besitzer nicht: Wer aus der Firma entfernt
  // wurde, hat auch über die API keinen Zugang mehr.
  const scope = await loadInvoiceScope(supabase, apiKeyRecord.user_id, apiKeyRecord.company_id)
  if (!scope) {
    return null
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKeyRecord.id)

  // Resolved here rather than per route so the plan check downstream costs no
  // extra round trip.
  const billing = await getBillingState(supabase, apiKeyRecord.company_id)

  return {
    companyId: apiKeyRecord.company_id,
    userId: apiKeyRecord.user_id,
    entitled: billing.entitled,
    isPro: billing.isPro,
    scope,
  }
}

const KEINE_ABTEILUNG = '00000000-0000-0000-0000-000000000000'

/**
 * Begrenzt eine Rechnungsabfrage auf die Abteilungen, die der Schlüsselbesitzer
 * sehen darf. Für Lesen und, nach `requireInvoiceWrite`, auch für Schreiben:
 * wer schreiben darf, sieht dieselben Abteilungen.
 */
export function scopeInvoices<Q>(query: Q, auth: ApiAuth): Q {
  const ids = readableDepartmentIds(auth.scope)
  if (ids === null) return query
  // Eine leere Liste in `.in()` ergäbe ungültiges Filter-Syntax.
  // Der Builder von PostgREST ist so tief verschachtelt, dass ein strukturell
  // getypter `.in` den Compiler ausbremst; der Rückgabetyp bleibt der des Aufrufers.
  return (query as unknown as { in: (c: string, v: string[]) => Q }).in(
    'department_id',
    ids.length > 0 ? ids : [KEINE_ABTEILUNG]
  )
}

/** 403 für Schlüssel, deren Besitzer keine Rechnungen ändern darf (Buchhaltung). */
export function requireInvoiceWrite(auth: ApiAuth): NextResponse | null {
  const ids = writableDepartmentIds(auth.scope)
  if (ids !== null && ids.length === 0) {
    return NextResponse.json(
      { error: 'The key owner may not modify invoices', code: 'FORBIDDEN' },
      { status: 403 }
    )
  }
  return null
}

/**
 * Plan enforcement for the public API, which blitzrechnung.de sells as a Pro
 * feature. Returns an error response to hand back, or null to proceed.
 */
export function requireApiAccess(auth: ApiAuth): NextResponse | null {
  if (!auth.entitled) {
    return paymentRequired('Your trial has ended. Choose a plan to keep using the API.')
  }
  if (!auth.isPro) {
    return paymentRequired('API access requires the Pro plan.')
  }
  return null
}

/**
 * Standard error responses
 */
export function unauthorized() {
  return NextResponse.json(
    { error: 'Invalid or missing API key', code: 'UNAUTHORIZED' },
    { status: 401 }
  )
}

export function paymentRequired(message: string) {
  return NextResponse.json(
    { error: message, code: 'PAYMENT_REQUIRED' },
    { status: 402 }
  )
}

export function forbidden() {
  return NextResponse.json(
    { error: 'Access denied', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

export function notFound(resource: string = 'Resource') {
  return NextResponse.json(
    { error: `${resource} not found`, code: 'NOT_FOUND' },
    { status: 404 }
  )
}

export function badRequest(message: string) {
  return NextResponse.json(
    { error: message, code: 'VALIDATION_ERROR' },
    { status: 400 }
  )
}

export function serverError(message: string = 'Internal server error') {
  return NextResponse.json(
    { error: message, code: 'SERVER_ERROR' },
    { status: 500 }
  )
}

/**
 * Standard success response
 */
export function json<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status })
}
