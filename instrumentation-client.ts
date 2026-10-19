import * as Sentry from '@sentry/nextjs'

/**
 * Browser-Initialisierung. Der öffentliche DSN ist ein eigener Wert und
 * bewusst von dem auf dem Server getrennt — er landet im Auslieferungsbundle.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
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
    // Sitzungsaufzeichnung ist aus: Auf dem Bildschirm stehen Kundennamen,
    // Adressen und Beträge.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
