import { Skeleton } from './skeleton'

/**
 * Ladezustand für die Listenseiten (Rechnungen, Entwürfe, Kontakte).
 *
 * Die Maße folgen der echten Tabelle: Filterleiste, Kopfzeile, dann Zeilen in
 * Zeilenhöhe. Weicht das Skelett von der fertigen Tabelle ab, springt der
 * Inhalt beim Umschalten — und ein springendes Layout wirkt langsamer als gar
 * kein Skelett.
 */
export function TableSkeleton({
  rows = 6,
  withToolbar = true,
}: {
  rows?: number
  withToolbar?: boolean
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Seitenkopf */}
      <div className="mb-12 flex items-center justify-between gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      {withToolbar && <Skeleton className="mb-6 h-10 w-full max-w-sm" />}

      <div className="flex flex-col gap-px">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
