import { Skeleton } from '@/components/ui/skeleton'

/**
 * Ladezustand für die Kontaktbearbeitung.
 *
 * Ohne diese Datei erbt die Seite das Tabellen-Skelett der Kontaktliste,
 * obwohl hier ein Formular folgt. Container (max-w-4xl statt max-w-7xl),
 * Karte und Feldhöhen folgen components/contacts/contact-editor.tsx.
 */

// Beschriftung (text-sm) + Eingabefeld (38px hoch) — sechsmal im Formular.
function FieldSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div>
      <Skeleton className={`h-4 ${labelWidth}`} />
      <Skeleton className="mt-1 h-[38px] w-full" />
    </div>
  )
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="space-y-6">
        {/* Titel + Zurück-Link */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-1 h-4 w-72" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-4">
            <FieldSkeleton labelWidth="w-20" />
            <FieldSkeleton labelWidth="w-16" />

            <div className="grid grid-cols-2 gap-4">
              <FieldSkeleton labelWidth="w-12" />
              <FieldSkeleton labelWidth="w-14" />
            </div>

            {/* Land ist ein Auswahlknopf (36px), kein Eingabefeld */}
            <div>
              <Skeleton className="h-4 w-12" />
              <Skeleton className="mt-1 h-9 w-full" />
            </div>

            <FieldSkeleton labelWidth="w-16" />
            <FieldSkeleton labelWidth="w-24" />

            {/* Abbrechen / Speichern */}
            <div className="flex justify-end gap-2 pt-4">
              <Skeleton className="h-[38px] w-28" />
              <Skeleton className="h-[38px] w-28" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
