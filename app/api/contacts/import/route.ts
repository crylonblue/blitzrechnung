import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_IMPORT_ROWS,
  duplicateKey,
  normalizeCountry,
  validateContact,
  type ImportContact,
} from '@/lib/contact-import'

const INSERT_CHUNK_SIZE = 500

// POST /api/contacts/import
// Body: { contacts: ImportContact[] } — bereits im Client aufbereitet. Hier wird
// erneut validiert und gegen bestehende Kontakte dedupliziert, denn der Client
// ist nicht vertrauenswürdig und die Vorschau kann veraltet sein.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { contacts?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ungültiger Request' }, { status: 400 })
  }

  if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
    return NextResponse.json({ error: 'Keine Kontakte übergeben' }, { status: 400 })
  }
  if (body.contacts.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Maximal ${MAX_IMPORT_ROWS} Kontakte pro Import` },
      { status: 400 }
    )
  }

  // Wie beim Anlegen einzelner Kontakte: die erste Firma des Nutzers.
  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1)
  const companyId = companyUsers?.[0]?.company_id
  if (!companyId) {
    return NextResponse.json({ error: 'Keine Firma gefunden' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('contacts')
    .select('name, address')
    .eq('company_id', companyId)
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const seen = new Set(
    (existing || []).map((c) => duplicateKey(c.name, (c.address as { zip?: string } | null)?.zip || ''))
  )

  const rows = []
  let invalid = 0
  let duplicates = 0
  for (const raw of body.contacts as ImportContact[]) {
    const contact = sanitize(raw)
    if (!contact || validateContact(contact).length > 0) {
      invalid++
      continue
    }
    const key = duplicateKey(contact.name, contact.address.zip)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    rows.push({ company_id: companyId, ...contact })
  }

  let created = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE)
    const { error } = await supabase.from('contacts').insert(chunk)
    if (error) {
      return NextResponse.json(
        { error: error.message, created, invalid, duplicates },
        { status: 500 }
      )
    }
    created += chunk.length
  }

  return NextResponse.json({ created, invalid, duplicates })
}

/** Übernimmt nur die bekannten Felder als Strings — alles andere im Body wird verworfen. */
function sanitize(raw: unknown): ImportContact | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const a = (r.address && typeof r.address === 'object' ? r.address : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  return {
    name: str(r.name),
    address: {
      street: str(a.street),
      streetnumber: str(a.streetnumber),
      zip: str(a.zip),
      city: str(a.city),
      country: normalizeCountry(str(a.country)) ?? '',
    },
    email: str(r.email) || null,
    vat_id: str(r.vat_id) || null,
  }
}
