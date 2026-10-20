import { Skeleton } from '@/components/ui/skeleton'

/** Ein Formularfeld: Label (text-xs, leading-none) über einem Input. */
function FieldSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div>
      <Skeleton className={`h-3 ${labelWidth}`} />
      {/* Input: 2px Rahmen + py-2 + 20px Zeilenhöhe */}
      <Skeleton className="mt-1.5 h-[38px] w-full" />
    </div>
  )
}

/**
 * Ladezustand der Einstellungen.
 *
 * Die Maße folgen components/settings/company-settings.tsx: Seitenkopf, eine
 * Reiterleiste mit sechs gleich breiten Reitern auf einer Unterlinie und
 * darunter eine Karte mit dem zuerst geöffneten Reiter „Firmendaten". Dessen
 * Formular ist nicht eine Liste gleicher Zeilen, sondern gegliedert: Firmenname,
 * Logo-Ablagefläche, Straße/Hausnummer im 3er-Raster, PLZ/Stadt im 2er-Raster,
 * Land, Steuer-Nummern und darunter der abgesetzte Abschnitt „Bankdaten".
 *
 * Das Skelett endet nach den Bankdaten-Feldern. Danach folgen auf der echten
 * Seite noch Schalter, Ansprechpartner, rechtliche Angaben und der
 * Speichern-Knopf — alles weit unterhalb des sichtbaren Bereichs, wo ein
 * nachwachsender Inhalt niemandem ins Auge springt. Ein Platzhalter dafür wäre
 * nur mehr Grau ohne Gewinn.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="space-y-8">
        {/* Seitenkopf: Überschrift (text-headline) und Unterzeile (text-meta) */}
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-5 w-72" />
        </div>

        <div className="flex flex-col gap-2">
          {/* Reiterleiste: Firmendaten, Rechnungen, E-Mail, API, Buchhaltung, Tarif.
              Die Reiter teilen sich die Breite (flex-1) und sitzen auf der Unterlinie. */}
          <div className="mb-8 flex w-full gap-8 border-b border-zinc-200 dark:border-zinc-700">
            {['w-24', 'w-20', 'w-14', 'w-8', 'w-24', 'w-10'].map((width) => (
              <div key={width} className="flex-1 border-b-2 border-transparent pt-1 pb-3.5">
                <Skeleton className={`mx-auto h-5 ${width}`} />
              </div>
            ))}
          </div>

          {/* Karte mit dem Inhalt des aktiven Reiters */}
          <div className="mt-6 rounded-xl bg-white py-6 shadow-sm">
            <div className="px-6 pt-6">
              <div className="space-y-6">
                {/* Abschnittsüberschrift der Karte: Titel und Beschreibung */}
                <div className="grid gap-2 pb-4">
                  <Skeleton className="h-7 w-36" />
                  <Skeleton className="h-5 w-80" />
                </div>

                <div className="space-y-4">
                  <FieldSkeleton labelWidth="w-28" />

                  {/* Firmenlogo: Überschrift und gestrichelte Ablagefläche */}
                  <div className="pt-4 pb-2">
                    <Skeleton className="mb-4 h-4 w-24" />
                    <div className="rounded-lg border-2 border-dashed border-zinc-300 p-6 dark:border-zinc-700">
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div className="h-12 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                        <div className="flex flex-col items-center">
                          <Skeleton className="h-6 w-32" />
                          <Skeleton className="mt-1 h-4 w-52" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <FieldSkeleton labelWidth="w-14" />
                    </div>
                    <FieldSkeleton labelWidth="w-24" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FieldSkeleton labelWidth="w-8" />
                    <FieldSkeleton labelWidth="w-12" />
                  </div>

                  {/* Land ist kein Input, sondern ein Auswahlknopf (h-9) */}
                  <div>
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="mt-1.5 h-9 w-full" />
                  </div>

                  <FieldSkeleton labelWidth="w-20" />
                  <FieldSkeleton labelWidth="w-24" />

                  {/* Abgesetzter Abschnitt „Bankdaten" */}
                  <div
                    className="mt-6 border-t pt-6"
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <Skeleton className="mb-4 h-4 w-20" />
                    <div className="space-y-4">
                      <FieldSkeleton labelWidth="w-24" />
                      <FieldSkeleton labelWidth="w-20" />
                      <FieldSkeleton labelWidth="w-10" />
                      <FieldSkeleton labelWidth="w-20" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
