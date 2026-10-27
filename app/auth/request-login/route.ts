import { NextRequest, NextResponse } from 'next/server'
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

  const ok = NextResponse.json({ success: true })
  try {
    const db = createServiceRoleClient()

    const { data: profile } = await db.from('user_profiles').select('id').eq('email', email).maybeSingle()
    if (!profile) return ok

    const { data: last } = await db.from('login_requests').select('requested_at').eq('email', email).maybeSingle()
    if (last && Date.now() - new Date(last.requested_at).getTime() < LOGIN_MAIL_INTERVAL_SECONDS * 1000) {
      return ok
    }
    await db.from('login_requests').upsert({ email, requested_at: new Date().toISOString() })

    const token = await createLoginToken(db, email, request.nextUrl.origin)
    await sendLoginMail(email, token)
  } catch (err) {
    // Nicht an den Aufrufer melden: auch ein Fehler darf nichts über das Konto verraten.
    console.error('request-login failed', err)
  }
  return ok
}
