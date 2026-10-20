import { Skeleton } from '@/components/ui/skeleton'

/**
 * Ladezustand der Übersicht.
 *
 * Die Maße folgen app/(app)/page.tsx: Seitenkopf, vier Kennzahl-Kacheln und
 * darunter zwei Spalten — links „Letzte Rechnungen" (bis zu fünf Karten),
 * rechts „Schnellzugriff" (drei Karten). Weicht das Skelett von der fertigen
 * Seite ab, springt der Inhalt beim Umschalten, und ein springendes Layout
 * wirkt langsamer als gar kein Skelett.
 *
 * Bewusst ohne Platzhalter für die beiden Banner („Firmendaten unvollständig",
 * „Noch N Tage im Test"), die auf der echten Seite über der Überschrift sitzen:
 * Ob sie erscheinen, hängt an Daten, die hier noch nicht geladen sind, und
 * beide sind unterschiedlich hoch. Ein reservierter Block würde die Überschrift
 * bei jedem Nutzer ohne Banner nach unten schieben und beim Laden wieder
 * hochspringen — also genau der Sprung, den das Skelett vermeiden soll, nur
 * ganz oben im Blickfeld. Die Überschrift startet deshalb dort, wo sie im
 * Normalfall (vollständige Firmendaten, bezahlter Tarif) auch landet.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Seitenkopf: Überschrift (text-headline) und Begrüßung (text-meta) */}
      <div className="mb-12">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-5 w-36" />
      </div>

      {/* Kennzahlen: Offen, Überfällig, Umsatz, Entwürfe */}
      <div className="mb-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'w-16', value: 'w-28', hint: 'w-20' },
          { label: 'w-24', value: 'w-28', hint: 'w-28' },
          { label: 'w-28', value: 'w-32', hint: 'w-28' },
          { label: 'w-20', value: 'w-10', hint: 'w-12' },
        ].map((kpi) => (
          <div key={kpi.label + kpi.value} className="card">
            <Skeleton className={`mb-1 h-5 ${kpi.label}`} />
            {/* text-3xl: 36px Zeilenhöhe */}
            <Skeleton className={`h-9 ${kpi.value}`} />
            <Skeleton className={`mt-1 h-4 ${kpi.hint}`} />
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Letzte Rechnungen — Überschrift mit „Alle anzeigen"-Link rechts */}
        <div>
          <div className="mb-6 flex items-center justify-between">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-5 w-28" />
          </div>

          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Skeleton className="h-6 w-28" />
                    <Skeleton className="mt-1 h-5 w-40" />
                    <Skeleton className="mt-1 h-4 w-32" />
                  </div>
                  <div className="flex flex-col items-end">
                    <Skeleton className="h-6 w-24" />
                    {/* status-badge: 12px Schrift plus 0.25rem Innenabstand */}
                    <Skeleton className="mt-2 h-[22px] w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Schnellzugriff — Überschrift ohne Link, drei Karten */}
        <div>
          <div className="mb-6">
            <Skeleton className="h-7 w-36" />
          </div>

          <div className="space-y-3">
            {[
              { title: 'w-32', hint: 'w-36' },
              { title: 'w-40', hint: 'w-32' },
              { title: 'w-28', hint: 'w-40' },
            ].map((item) => (
              <div key={item.title + item.hint} className="card">
                <Skeleton className={`h-6 ${item.title}`} />
                <Skeleton className={`mt-1 h-5 ${item.hint}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
