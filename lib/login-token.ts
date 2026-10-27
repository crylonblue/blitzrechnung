import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, getDefaultFromEmail } from '@/lib/email'

/**
 * Anmeldung per Link und Code, versendet über unseren Mailer (AhaSend) statt
 * über Supabase-SMTP: Einladung und Anmeldung teilen sich dieselbe Technik, und
 * es gibt weder die Ratenlimits noch die Dashboard-Vorlage des Supabase-Mailers.
 *
 * Supabase erzeugt den Token (`generateLink`), wir verschicken ihn. Ein Token
 * liefert beides: den Hash für den Link und den 6-stelligen Code. Beides
 * meldet denselben Nutzer an; wer den Link nicht öffnen kann (anderes Gerät),
 * tippt den Code ein.
 */

/** Mindestabstand zwischen zwei Mails an dieselbe Adresse. */
export const LOGIN_MAIL_INTERVAL_SECONDS = 60

export interface LoginToken {
  link: string
  code: string
}

/**
 * Basis-URL der Links in unseren Mails. Sie kommt aus der Konfiguration, nie aus
 * dem Request: Den Host-Header kann ein Aufrufer setzen, und /auth/request-login
 * ist ohne Anmeldung erreichbar. Sonst ließe sich eine echte Mail mit einem Link
 * auf eine fremde Domain auslösen, die den Token abgreift.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000'
  throw new Error('NEXT_PUBLIC_SITE_URL ist nicht gesetzt')
}

/** Erzeugt Link und Code für ein bestehendes Konto. Legt nie ein Konto an. */
export async function createLoginToken(db: SupabaseClient, email: string): Promise<LoginToken> {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties) throw new Error(error?.message ?? 'Anmelde-Token konnte nicht erzeugt werden')
  const { hashed_token, email_otp } = data.properties
  return {
    link: `${siteUrl()}/auth/token?token_hash=${encodeURIComponent(hashed_token)}`,
    code: email_otp,
  }
}

/**
 * Ohne Mail-Zugang (lokale Entwicklung) landet die Mail im Log statt zu
 * scheitern; in Produktion gilt weiterhin: kein Versand, kein stilles Schlucken.
 */
async function deliver(to: string, subject: string, textBody: string): Promise<void> {
  if (!process.env.AHASEND_API_KEY && process.env.NODE_ENV !== 'production') {
    console.log(`[mail:dev] an ${to}\nBetreff: ${subject}\n\n${textBody}\n`)
    return
  }
  await sendEmail({ from: getDefaultFromEmail(), to, subject, textBody })
}

export async function sendLoginMail(to: string, token: LoginToken): Promise<void> {
  await deliver(
    to,
    'Ihre Anmeldung bei Blitzrechnung',
    `Anmelden mit einem Klick:\n${token.link}\n\nOder diesen Code eingeben: ${token.code}\n\nLink und Code gelten 15 Minuten und nur einmal. Wenn Sie das nicht angefordert haben, können Sie diese Mail ignorieren.`
  )
}

export async function sendInviteMail(
  to: string,
  token: LoginToken,
  opts: { companyName: string; inviterName: string | null }
): Promise<void> {
  const who = opts.inviterName ? `${opts.inviterName} hat Sie` : 'Sie wurden'
  await deliver(
    to,
    `Einladung zu ${opts.companyName}`,
    `${who} zu ${opts.companyName} in Blitzrechnung eingeladen. Ihr Zugang ist bereits angelegt.\n\nJetzt anmelden:\n${token.link}\n\nOder diesen Code eingeben: ${token.code}\n\nLink und Code gelten 15 Minuten und nur einmal. Später melden Sie sich jederzeit unter Anmelden → „Mit Link oder Code anmelden“ an; dort bekommen Sie einen neuen Code.`
  )
}
