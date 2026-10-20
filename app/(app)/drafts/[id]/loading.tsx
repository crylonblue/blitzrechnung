import { Skeleton } from '@/components/ui/skeleton'

/**
 * Ladezustand für den Entwurfseditor.
 *
 * Ohne diese Datei greift drafts/loading.tsx — und dann blitzt vor dem
 * Formular kurz das Skelett einer Tabelle auf. Maße und Container folgen
 * deshalb exakt components/drafts/draft-editor.tsx (Kopf, scrollender
 * Abschnittsbereich, fest sitzende Aktionsleiste), damit beim Umschalten
 * nichts springt.
 */

// Beschriftung + Feld, wie sie im Editor ein Dutzend Mal vorkommen:
// text-xs-Label, darunter mit mt-1.5 ein 36px hohes Eingabefeld.
function FieldSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div>
      <Skeleton className={`h-3 ${labelWidth}`} />
      <Skeleton className="mt-1.5 h-9 w-full" />
    </div>
  )
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex h-full flex-col">
        {/* Kopf: Titel + Statuszeile */}
        <div
          className="flex-shrink-0 border-b p-6 pb-4"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-44" />
        </div>

        <div className="flex-1 px-6 pt-6">
          <div className="space-y-8 pb-6">
            <div>
              {/* Von (Absender) */}
              <Skeleton className="mb-4 h-3 w-28" />
              <Skeleton className="h-9 w-full" />

              {/* An (Empfänger) — im Editor durch eine Linie abgetrennt */}
              <div
                className="mt-6 border-t pt-6"
                style={{ borderColor: 'var(--border-default)' }}
              >
                <Skeleton className="mb-4 h-3 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>

            {/* Datum: zwei Felder nebeneinander, das dritte darunter.
                Die Rechnungsnummer steht nicht mehr hier, sondern am Ende
                des Formulars hinter einer eingeklappten Aufklappstelle. */}
            <div>
              <Skeleton className="mb-4 h-3 w-16" />
              <div className="grid grid-cols-2 gap-4">
                <FieldSkeleton labelWidth="w-28" />
                <FieldSkeleton labelWidth="w-32" />
                <FieldSkeleton labelWidth="w-28" />
              </div>
            </div>

            {/* Referenz: ein Textfeld plus Hinweiszeile */}
            <div>
              <Skeleton className="mb-4 h-3 w-20" />
              <FieldSkeleton labelWidth="w-56" />
              <Skeleton className="mt-1.5 h-3 w-64" />
            </div>

            {/* Positionen: Hinweiszeile und der Knopf „Position hinzufügen" */}
            <div>
              <Skeleton className="mb-4 h-3 w-24" />
              <div className="space-y-4">
                <Skeleton className="h-4 w-60" />
                <Skeleton className="h-[38px] w-full" />
              </div>
            </div>

            {/* Eingeklappte Zeile „Rechnungsnummer manuell vergeben“ —
                im Editor eine <summary>-Zeile über einer Trennlinie */}
            <div
              className="border-t pt-6"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <Skeleton className="h-5 w-64" />
            </div>
          </div>
        </div>

        {/* Aktionsleiste: Löschen links, drei Knöpfe rechts — klebt wie im
            Editor unten, damit beim Umschalten nichts springt */}
        <div
          className="sticky bottom-0 z-10 flex-shrink-0 border-t bg-background px-6 py-4"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-28" />
            <div className="flex gap-3">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-9 w-52" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
