import { Skeleton } from '@/components/ui/skeleton'

/**
 * Ladezustand für die Zwischenseite „Neuer Entwurf".
 *
 * Die Seite ist nur Titel, Hinweis und ein Knopf — für sich genommen zu wenig,
 * um ein Skelett zu rechtfertigen. Ohne diese Datei greift aber
 * drafts/loading.tsx und zeigt eine ganze Tabelle an; drei Balken an der
 * richtigen Stelle sind deutlich ruhiger. Das Anlegen des Entwurfs selbst
 * meldet der Knopf danach mit seinem eigenen Spinner.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
    </div>
  )
}
