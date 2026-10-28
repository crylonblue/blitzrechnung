import { after, NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createLoginToken, sendLoginMail, LOGIN_MAIL_INTERVAL_SECONDS } from '@/lib/login-token'
import { isEmail } from '@/lib/team'

/**
 * POST /auth/request-login  Body: { email }
 *
 * Schickt Link und Code für ein bestehendes Konto. Die Antwort ist immer
 * dieselbe, ob es das Konto gibt oder nicht — sonst ließe sich hier prüfen,
 * wer Kunde ist. Neue Konten entstehen nur über Einladung oder Registrierung.
 *
 * Gebremst wird je Adresse (ein Versand je Minute), damit niemand fremde
 * Postfächer mit Mails flutet.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isEmail(email)) {
    return NextResponse.json({ error: 'Bitte eine gültige E-Mail-Adresse angeben' }, { status: 400 })
  }

  // Alles Weitere läuft nach der Antwort: Sonst verriete die Antwortzeit, ob es
  // das Konto gibt (bekannte Adressen brauchen Lookup, Token und Mailversand).
  after(() => sendIfKnown(email))
  return NextResponse.json({ success: true })
}

/**
 * Den Slot für diese Adresse atomar belegen: erst ein UPDATE, das nur trifft,
 * wenn der letzte Versand lange genug her ist, sonst ein INSERT, das bei einer
 * vorhandenen Zeile nichts tut. Zwei gleichzeitige Anfragen kommen so nicht
 * beide durch.
 */
async function claimSlot(db: SupabaseClient, email: string): Promise<boolean> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - LOGIN_MAIL_INTERVAL_SECONDS * 1000).toISOString()
  const { data: updated } = await db
    .from('login_requests')
    .update({ requested_at: now.toISOString() })
    .eq('email', email)
    .lt('requested_at', cutoff)
    .select('email')
  if (updated && updated.length > 0) return true
  const { data: inserted } = await db
    .from('login_requests')
    .upsert({ email, requested_at: now.toISOString() }, { onConflict: 'email', ignoreDuplicates: true })
    .select('email')
  return !!inserted && inserted.length > 0
}

async function sendIfKnown(email: string) {
  try {
    const db = createServiceRoleClient()
    const { data: profile } = await db.from('user_profiles').select('id').eq('email', email).maybeSingle()
    if (!profile) return
    if (!(await claimSlot(db, email))) return

    try {
      const token = await createLoginToken(db, email)
      await sendLoginMail(email, token)
    } catch (err) {
      // Ohne Mail soll die Person nicht eine Minute lang gesperrt sein.
      await db.from('login_requests').delete().eq('email', email)
      throw err
    }
  } catch (err) {
    // Nicht an den Aufrufer melden: auch ein Fehler darf nichts über das Konto verraten.
    console.error('request-login failed', err)
  }
}
