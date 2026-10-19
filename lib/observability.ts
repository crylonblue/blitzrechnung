import * as Sentry from '@sentry/nextjs'

/**
 * Fehlermeldung aus der Anwendung heraus.
 *
 * Bis hierher landeten Fehler ausschließlich in `console.error` und damit in
 * Vercel-Logs, die niemand liest und die niemanden benachrichtigen. Schlug bei
 * einem Kunden der Rechnungsversand fehl, erfuhr man es vom Kunden — oder gar
 * nicht.
 *
 * Ist `SENTRY_DSN` nicht gesetzt, bleibt alles beim Alten: Es wird nichts
 * gesendet, nichts initialisiert, keine Verbindung aufgebaut. Die Anwendung
 * läuft also unverändert weiter, bis jemand den DSN hinterlegt.
 */
export const observabilityAktiv = Boolean(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
)

/** Zusatzangaben, die beim Suchen helfen — niemals personenbezogene Inhalte. */
export interface Fehlerkontext {
  /** Wo es passiert ist, z. B. 'invoice.finalize' oder 'email.send'. */
  bereich: string
  companyId?: string
  invoiceId?: string
  /** Weitere technische Kennungen. Keine Namen, keine Adressen, keine Beträge. */
  extra?: Record<string, string | number | boolean | null | undefined>
}

/**
 * Meldet einen Fehler und schreibt ihn weiterhin ins Log.
 *
 * Das Log bleibt bewusst erhalten: Es ist die einzige Quelle, solange kein DSN
 * gesetzt ist, und beim Nachstellen eines Problems im Terminal weiterhin das
 * schnellste Werkzeug.
 */
export function meldeFehler(fehler: unknown, kontext: Fehlerkontext): void {
  console.error(`[${kontext.bereich}]`, fehler)

  if (!observabilityAktiv) return

  Sentry.withScope((scope) => {
    scope.setTag('bereich', kontext.bereich)
    if (kontext.companyId) scope.setTag('company_id', kontext.companyId)
    if (kontext.invoiceId) scope.setTag('invoice_id', kontext.invoiceId)
    if (kontext.extra) scope.setContext('details', kontext.extra)
    Sentry.captureException(fehler)
  })
}

/**
 * Meldet einen Zustand, der kein geworfener Fehler ist, aber Aufmerksamkeit
 * verdient — etwa ein Stripe-Webhook zu einem unbekannten Preis.
 */
export function meldeWarnung(nachricht: string, kontext: Fehlerkontext): void {
  console.warn(`[${kontext.bereich}] ${nachricht}`)

  if (!observabilityAktiv) return

  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setTag('bereich', kontext.bereich)
    if (kontext.companyId) scope.setTag('company_id', kontext.companyId)
    if (kontext.invoiceId) scope.setTag('invoice_id', kontext.invoiceId)
    if (kontext.extra) scope.setContext('details', kontext.extra)
    Sentry.captureMessage(nachricht)
  })
}
