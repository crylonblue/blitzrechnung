import * as Sentry from '@sentry/nextjs'

/**
 * Server- und Edge-Initialisierung der Fehlerüberwachung.
 *
 * Ohne SENTRY_DSN passiert hier bewusst nichts: keine Initialisierung, keine
 * Verbindung, kein Overhead. Die Anwendung verhält sich dann exakt wie vorher.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    // Fehler sind das Ziel, nicht Performance-Messung. Tracing bleibt aus,
    // damit das kostenlose Kontingent nicht von Routineanfragen aufgebraucht
    // wird, bevor ein echter Fehler darin Platz findet.
    tracesSampleRate: 0,
    // Rechnungsdaten sind Geschäftsgeheimnisse der Kunden. Nichts mitschicken,
    // was über technische Kennungen hinausgeht — insbesondere keine
    // Anfrage-Inhalte, in denen Positionen und Beträge stehen.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  })
}

export const onRequestError = Sentry.captureRequestError
