import { Skeleton } from '@/components/ui/skeleton'

/**
 * Ladezustand für die Rechnungsansicht.
 *
 * Ohne diese Datei erbt die Seite das Listen-Skelett aus invoices/loading.tsx
 * — eine Tabelle über die volle Breite, obwohl hier ein Rechnungsbeleg in
 * einer Karte folgt. Aufbau und Abstände spiegeln die echte Seite:
 * Kopfzeile mit Statusaktionen, Aktionsknöpfe, dann die Belegkarte aus
 * components/invoices/invoice-view.tsx.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Rechnungsnummer + Status, rechts die Statusaktionen */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-5 w-24" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>

      {/* Versenden / Stornieren */}
      <div className="mb-8 flex flex-wrap gap-3">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-9 w-48" />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Von / An */}
        <div className="mb-8 grid grid-cols-2 gap-8">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-10" />
              <Skeleton className="mt-2 h-5 w-44" />
              <div className="mt-1 flex flex-col gap-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>

        {/* Nummer, Rechnungs- und Fälligkeitsdatum */}
        <div className="mb-8 grid grid-cols-3 gap-8 border-t border-zinc-200 pt-8 dark:border-zinc-700">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1 h-4 w-28" />
            </div>
          ))}
        </div>

        {/* Positionstabelle: Kopfzeile plus Zeilen in Zeilenhöhe */}
        <div className="mb-8">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="flex flex-col gap-px">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </div>

        {/* Summenblock, rechtsbündig in 16rem Breite */}
        <div className="border-t border-zinc-200 pt-8 dark:border-zinc-700">
          <div className="ml-auto w-64 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>

        {/* PDF- und XML-Download */}
        <div className="mt-8 flex gap-3 border-t border-zinc-200 pt-8 dark:border-zinc-700">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-64" />
        </div>
      </div>
    </div>
  )
}
