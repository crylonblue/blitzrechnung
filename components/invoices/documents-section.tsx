'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  BellRing,
  Clock,
  FileCode,
  FileText,
  LoaderCircle,
  Receipt,
  SendHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getStatusClass, getStatusLabel } from '@/lib/invoice-utils'
import type { Invoice } from '@/types'
import AddDocument from './add-document'
import {
  sendeMahnung,
  verwirfMahnung,
  type DunningStatus,
  type DunningVerlaufEintrag,
} from './dunning-api'

/**
 * Die Dokumente einer Rechnung — in einer Liste, nicht verstreut.
 *
 * Der Anlass: Wer gemahnt hatte, sah in der Schublade **eine Zeile** Verlauf
 * („Zahlungserinnerung am 21.10. · 1. Mahnung vorgesehen ab 04.11.") und sonst
 * nichts. Welche Mahnungen es gibt, was sie forderten und in welchem Zustand
 * sie sind, stand nirgends; die Dateien der Rechnung standen als zwei lose
 * Knöpfe zwischen den Aktionen.
 *
 * Hier stehen beide Arten in **einer** Liste, weil der Nutzer sie als eine
 * Sache denkt: „was gibt es zu dieser Rechnung?". Die Rechnung ist der erste
 * Eintrag, jede Mahnung ein weiterer, und jeder Eintrag hat dieselben vier
 * Angaben — Name, Datum, Betrag und (bei Mahnungen) Zustand — plus denselben
 * Platz für die Datei.
 *
 * **Hier wird auch gehandelt, nicht nur gezeigt.** Eine Mahnung entsteht als
 * fertiges Dokument und hat danach genau drei mögliche Fortsetzungen:
 * herunterladen, per E-Mail senden, löschen. Alle drei stehen in ihrer Zeile —
 * also an dem Blatt, um das es geht. Und weil der Abschnitt „Dokumente" heisst,
 * entsteht ein neues Dokument auch hier: „Dokument hinzufügen" steht am Ende
 * der Liste, dort, wo das nächste stehen wird.
 *
 * **Es gibt keinen Entwurf.** Eine Mahnung wird mit ihrem PDF angelegt; was
 * ihr bis zum Versand fehlt, ist die E-Mail, nicht das Dokument. Deshalb heisst
 * `created` hier „Erstellt" und nicht „Entwurf" — wer per Post mahnt, ist mit
 * diesem Zustand fertig und druckt bloss noch aus.
 *
 * **Gezeigt wird nach Lage, nicht nach Schema.** Ohne Mahnung ist das hier
 * schlicht die Zeile der Rechnung mit ihren Downloads — keine leere Tabelle,
 * keine Überschrift ohne Inhalt. Mit drei Mahnungen stehen alle drei
 * untereinander. Und der Ausblick auf die nächste Stufe ist die letzte,
 * gestrichelte Zeile: Er steht chronologisch da, wo er hingehört, und ersetzt
 * damit die alte Verlaufszeile aus `dunning-section.tsx`.
 */

/** „21. Okt 2026" — gleiche Schreibweise wie im Kopf der Schublade. */
function tag(iso: string): string {
  // Bewusst nicht `new Date(iso)`: Ein ISO-Tag wird als UTC-Mitternacht
  // gelesen und rutscht westlich von Greenwich auf den Vortag. Die drei Zahlen
  // von Hand in ein lokales Datum zu setzen, kennt dieses Problem nicht.
  const [jahr, monat, t] = iso.split('-').map(Number)
  return format(new Date(jahr, monat - 1, t), 'd. MMM yyyy', { locale: de })
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

// ---------------------------------------------------------------------------
// Der Zustand einer Mahnung
// ---------------------------------------------------------------------------

interface Zustand {
  label: string
  /** Plakettenklasse aus `lib/invoice-utils.ts` — dieselben Farben wie überall. */
  klasse: string
  /** Ein Satz dazu; hängt als `title` an der Plakette. */
  erklaerung: string
}

/**
 * Der Zustand wird **abgeleitet**, nicht gespeichert.
 *
 * In der Datenbank kennt eine Mahnung nur `created` und `sent` (CHECK in
 * Migration 040). Mehr Spalten braucht es auch nicht: **Eine Mahnung wird nie
 * selbst bezahlt** — bezahlt wird die Rechnung, und das färbt auf ihre
 * Mahnungen ab. Eine eigene Spalte „bezahlt" an der Mahnung wäre eine zweite
 * Wahrheit neben `invoices.status`, die irgendwann auseinanderläuft.
 *
 * **Welcher Zustand gewinnt, wenn mehrere zutreffen** — die Reihenfolge hier
 * ist die Antwort, und sie folgt einer Regel: Was über **dieses Blatt** wahr
 * ist, schlägt, was über die **Forderung** wahr ist.
 *
 *  1. `superseded_by` → „Ersetzt". Eine abgelöste Fassung ist aus dem Verkehr
 *     gezogen; sie als „Versendet" oder „Erledigt" zu führen, hiesse, sie
 *     weiter als geltende Mahnung auszugeben. Auch `naechsteStufe` zählt sie
 *     nicht mehr mit (vgl. `gueltige()` in `lib/dunning-claim.ts`).
 *  2. `created` → „Erstellt". Hier weiche ich bewusst von der vorgeschlagenen
 *     Zuordnung ab, nach der eine bezahlte Rechnung jede ihrer Mahnungen auf
 *     „Erledigt" setzt: Ein erstelltes Schreiben **ging nie per E-Mail
 *     hinaus**. Was aus der Forderung wurde, sagt darüber nichts — es bleibt
 *     ein Blatt, das man noch verschicken oder löschen kann, und genau diese
 *     Knöpfe trägt seine Zeile. „Erledigt" würde sie zudecken.
 *  3. Rechnung `cancelled`/`uneinbringlich` → „Gegenstandslos", und erst
 *  4. Rechnung `paid` → „Erledigt". Beides sind Endzustände der Rechnung und
 *     schliessen einander aus; die Reihenfolge entscheidet hier nichts.
 *  5. sonst `sent` → „Versendet": draussen und noch offen.
 */
function zustandDerMahnung(mahnung: DunningVerlaufEintrag, rechnungsStatus: string): Zustand {
  if (mahnung.superseded_by) {
    return {
      label: 'Ersetzt',
      // Neutral wie ein Entwurf: abgelöst ist kein Fehler, nur nicht mehr gültig.
      klasse: getStatusClass('draft'),
      erklaerung: 'Durch eine neuere Fassung abgelöst — diese Mahnung zählt nicht mehr.',
    }
  }

  if (mahnung.status === 'created') {
    return {
      label: getStatusLabel('created'),
      klasse: getStatusClass('created'),
      erklaerung:
        'Erstellt und als PDF abgelegt, aber nicht per E-Mail verschickt. Zum Herunterladen und Ausdrucken bereit.',
    }
  }

  if (rechnungsStatus === 'cancelled' || rechnungsStatus === 'uneinbringlich') {
    return {
      label: 'Gegenstandslos',
      klasse: getStatusClass('cancelled'),
      erklaerung:
        rechnungsStatus === 'cancelled'
          ? 'Die Rechnung wurde storniert — es besteht keine Forderung mehr, die diese Mahnung geltend machen könnte.'
          : 'Die Forderung ist als uneinbringlich abgeschrieben — diese Mahnung läuft ins Leere.',
    }
  }

  if (rechnungsStatus === 'paid') {
    return {
      label: 'Erledigt',
      klasse: getStatusClass('paid'),
      // Nicht „Bezahlt": Bezahlt wurde die Rechnung, nicht dieses Schreiben.
      erklaerung: 'Die Rechnung ist bezahlt — diese Mahnung hat sich erledigt.',
    }
  }

  return {
    label: getStatusLabel('sent'),
    klasse: getStatusClass('sent'),
    erklaerung: mahnung.sent_at
      ? `Am ${tag(mahnung.sent_at.split('T')[0])} per E-Mail verschickt; die Forderung ist weiterhin offen.`
      : 'Per E-Mail verschickt; die Forderung ist weiterhin offen.',
  }
}

// ---------------------------------------------------------------------------
// Der Ausblick auf die nächste Stufe
// ---------------------------------------------------------------------------

/**
 * Was die alte Verlaufszeile an Nützlichem hatte: die Auskunft über den
 * **nächsten** Schritt. Die Liste zeigt, was war; dieser Satz, was kommt.
 *
 * `null` heisst, dass es dazu nichts zu sagen gibt — etwa bei einer bezahlten
 * oder stornierten Rechnung, für die die Route gar keine Stufe mehr ermittelt.
 * Dann steht hier auch nichts; eine Zeile „nichts geplant" wäre Lärm.
 */
function ausblickText(status: DunningStatus | null, hatMahnungen: boolean): string | null {
  if (!status) return null
  // Kein Ausblick, sondern ein Ergebnis: Dass nichts mehr eskaliert werden
  // kann, ist eine Auskunft und keine Lücke.
  if (status.alleStufenDurchlaufen) return 'Alle Mahnstufen sind durchlaufen.'
  if (!status.stufe) return null

  const vorspann = hatMahnungen ? '' : 'Noch nicht gemahnt. '
  // „vorgesehen ab" statt „möglich ab": Gemahnt werden darf auch früher (die
  // Route sperrt das nicht), das Datum sagt nur, wann die Stufe nach dem
  // eingerichteten Zeitplan an der Reihe ist.
  const satz =
    !status.istFaellig && status.faelligAb
      ? `${status.stufe.name} ist ab ${tag(status.faelligAb)} vorgesehen.`
      : `${status.stufe.name} ist der nächste Schritt.`

  return `${vorspann}${satz}`
}

// ---------------------------------------------------------------------------
// Eine Zeile
// ---------------------------------------------------------------------------

function Zeile({
  symbol,
  titel,
  meta,
  plakette,
  children,
}: {
  symbol: React.ReactNode
  titel: string
  meta: string
  plakette?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {symbol}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* `break-words` statt `truncate`: Ein Stufenname darf lang sein
                („Letzte Mahnung vor Abgabe an ein Inkassobüro") und muss in
                einer rund 390 px breiten Schublade trotzdem vollständig
                lesbar bleiben. Abgeschnitten wäre er unbrauchbar. */}
            <p className="min-w-0 break-words text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {titel}
            </p>
            {plakette}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{meta}</p>
          {children}
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Der Abschnitt
// ---------------------------------------------------------------------------

interface DocumentsSectionProps {
  invoice: Invoice
  /**
   * Der Mahnstatus, von der Schublade geholt. `null` heisst „noch nicht da
   * oder nicht abrufbar" — die Zeile der Rechnung steht dann trotzdem, denn
   * ihre Dateien hängen nicht am Mahnwesen.
   */
  status: DunningStatus | null
  hatPdf: boolean
  hatXml: boolean
  onPdf: () => void
  onXml: () => void
  pdfLaedt: boolean
  xmlLaedt: boolean
  /** Nach jeder Änderung an einem Dokument: Rechnung und Mahnstatus neu laden. */
  onGeaendert: () => void
  /** Name des Empfängers, von der Schublade schon aufgelöst. */
  empfaenger: string
  /** Name der eigenen Firma — die Unterschrift unter dem Mahnschreiben. */
  absender: string
  /** Darf diese Rechnung überhaupt gemahnt werden? Sonst gibt es nichts hinzuzufügen. */
  istMahnbar: boolean
  /** Die Mahnschublade meldet „ist längst bezahlt" — die Rechnung geht zu. */
  onPaid: () => void
  /** Mahnen ist der wahrscheinliche nächste Schritt — dann wird der Knopf betont. */
  betont: boolean
}

export default function DocumentsSection({
  invoice,
  status,
  hatPdf,
  hatXml,
  onPdf,
  onXml,
  pdfLaedt,
  xmlLaedt,
  onGeaendert,
  empfaenger,
  absender,
  istMahnbar,
  onPaid,
  betont,
}: DocumentsSectionProps) {
  const [laeuft, setLaeuft] = useState<{ id: string; was: 'senden' | 'loeschen' } | null>(null)

  const mahnungen = status?.verlauf ?? []
  const ausblick = ausblickText(status, mahnungen.length > 0)
  const kannHinzufuegen = istMahnbar && (status?.stufen.length ?? 0) > 0

  // Ohne Datei, ohne Mahnung, ohne Ausblick und ohne etwas zum Hinzufügen gäbe
  // es nur eine Überschrift über einer Zeile ohne Inhalt — dann lieber null
  // Pixel.
  if (!hatPdf && !hatXml && mahnungen.length === 0 && !ausblick && !kannHinzufuegen) return null

  const handleLoeschen = async (reminderId: string) => {
    setLaeuft({ id: reminderId, was: 'loeschen' })
    try {
      await verwirfMahnung(reminderId)
      toast.success('Mahnung gelöscht')
      onGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Die Mahnung konnte nicht gelöscht werden.')
    } finally {
      setLaeuft(null)
    }
  }

  /**
   * Senden ohne Zwischenbildschirm.
   *
   * Der Text steht fest, bevor hier geklickt wird: Entweder er wurde in der
   * Schublade geschrieben, oder es gilt der vorbereitete, den der Server
   * ohnehin baut. Eine Rückfrage an dieser Stelle wäre eine Frage an jemanden,
   * der gerade geantwortet hat.
   */
  const handleSenden = async (reminderId: string, stufenname: string) => {
    setLaeuft({ id: reminderId, was: 'senden' })
    try {
      const { empfaengerEmail } = await sendeMahnung(reminderId)
      toast.success(`${stufenname} versendet`, { description: `An ${empfaengerEmail}.` })
      onGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Die Mahnung konnte nicht versendet werden.')
    } finally {
      setLaeuft(null)
    }
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Dokumente
      </h3>

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {/* Die Rechnung selbst — der erste Beleg, nicht ein Sonderfall.
            Bewusst **ohne** Plakette: Ihr Status steht als Plakette im Kopf
            der Schublade, zwei Fingerbreit darüber. Ihn hier zu wiederholen
            wäre dieselbe Auskunft zweimal; die Plaketten in dieser Liste
            gehören den Zuständen, die sonst nirgends stehen. */}
        <Zeile
          symbol={<Receipt className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />}
          titel={invoice.invoice_number ? `Rechnung ${invoice.invoice_number}` : 'Rechnung'}
          meta={`${invoice.invoice_date ? tag(invoice.invoice_date) : 'ohne Datum'} · ${euro.format(invoice.total_amount)}`}
        >
          {/* Zwei verschiedene Dokumente, deshalb zwei Beschriftungen:
               * Das **PDF** ist der ZUGFeRD-Hybrid (`lib/pdf-generator.ts`
                 ruft `embedFacturX` mit `Flavor.ZUGFERD`) — ein Dokument, das
                 ein Mensch ansehen und eine Software auslesen kann.
               * Die **XML-Datei** ist die XRechnung
                 (`lib/zugferd-generator.ts`, CustomizationID
                 `…kosit:xrechnung_3.0`): reines XML ohne Ansicht, das Format,
                 das öffentliche Auftraggeber verlangen.
              Der Satz, der sagt, wann man welche nimmt, passt auf keinen
              Knopf und steht deshalb darunter, wo er beide zugleich erklärt.
              `flex-1` statt festem Raster: Fehlt eine der Dateien, füllt die
              andere die Zeile, statt halb stehen zu bleiben. */}
          {(hatPdf || hatXml) && (
            <div className="mt-2 flex gap-2">
              {hatPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1"
                  onClick={onPdf}
                  disabled={pdfLaedt}
                  aria-label="Rechnung als PDF mit eingebetteter ZUGFeRD-Datei herunterladen"
                  title="Rechnung als PDF mit eingebetteter ZUGFeRD-Datei herunterladen"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{pdfLaedt ? 'Lädt...' : 'PDF (ZUGFeRD)'}</span>
                </Button>
              )}
              {hatXml && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1"
                  onClick={onXml}
                  disabled={xmlLaedt}
                  aria-label="Rechnung als XRechnung im XML-Format herunterladen"
                  title="Rechnung als XRechnung im XML-Format herunterladen"
                >
                  <FileCode className="h-4 w-4 shrink-0" />
                  <span className="truncate">{xmlLaedt ? 'Lädt...' : 'XML (XRechnung)'}</span>
                </Button>
              )}
            </div>
          )}

          {/* Satzweise an die vorhandenen Dateien geknüpft: Fehlt eine der
              beiden, wäre der Satz über sie eine Auskunft über etwas, das
              hier gar nicht angeboten wird. */}
          {(hatPdf || hatXml) && (
            <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              {hatPdf &&
                'Das PDF trägt die ZUGFeRD-Daten in sich und lässt sich lesen wie auslesen — damit kommen die meisten Empfänger aus. '}
              {hatXml &&
                'Die XML-Datei ist die XRechnung; sie verlangen vor allem Behörden und öffentliche Auftraggeber.'}
            </p>
          )}

          {!hatPdf && !hatXml && (
            <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              Zu dieser Rechnung ist noch keine Datei erzeugt worden.
            </p>
          )}
        </Zeile>

        {mahnungen.map((mahnung) => {
          const zustand = zustandDerMahnung(mahnung, invoice.status)
          const gilt = !mahnung.superseded_by
          // Löschen nur, solange nichts per E-Mail hinausging: Ein verschicktes
          // Schreiben ist ein Handelsbrief und bleibt. (Die Löschregel der
          // Tabelle setzt dasselbe noch einmal durch.)
          const loeschbar = gilt && mahnung.status === 'created'
          // Senden braucht ein Dokument. Eine gegenstandslose Mahnung — die
          // Rechnung ist bezahlt oder storniert — wird nicht mehr verschickt;
          // das wäre peinlich und nicht nur falsch.
          const sendbar = gilt && Boolean(mahnung.pdf_url) && istMahnbar
          const amLaufen = laeuft?.id === mahnung.id

          return (
            <Zeile
              key={mahnung.id}
              symbol={<BellRing className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />}
              titel={mahnung.stage_name}
              meta={`${tag(mahnung.reminder_date)} · ${euro.format(mahnung.total_amount)}`}
              plakette={
                // Die Plakette trägt den Zustand als **Wort**, nicht als
                // Farbe allein — lesbar auch ohne Farbwahrnehmung. Der
                // `title` erklärt, woraus er sich ergibt.
                <span className={`${zustand.klasse} shrink-0`} title={zustand.erklaerung}>
                  {zustand.label}
                </span>
              }
            >
              {/* Die beiden Knöpfe, die ein erstelltes Mahnschreiben hat:
                  ansehen und senden. Sie stehen nebeneinander und gleich
                  gewichtet — welcher der richtige ist, entscheidet der
                  Postweg, nicht die Software. */}
              {(mahnung.pdf_url || sendbar) && (
                <div className="mt-2 flex gap-2">
                  {mahnung.pdf_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1"
                      onClick={() => window.open(mahnung.pdf_url as string, '_blank')}
                      aria-label={`${mahnung.stage_name} als PDF herunterladen`}
                      title={`${mahnung.stage_name} als PDF herunterladen`}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">PDF</span>
                    </Button>
                  )}
                  {sendbar && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1"
                      disabled={amLaufen}
                      onClick={() => handleSenden(mahnung.id, mahnung.stage_name)}
                      // „Erneut senden" sagt dem Nutzer, dass er nichts
                      // Neues auslöst, sondern dasselbe Schreiben noch einmal
                      // schickt — der Tag des ersten Versands bleibt stehen.
                      title={
                        mahnung.status === 'sent'
                          ? 'Dasselbe Mahnschreiben noch einmal per E-Mail schicken'
                          : 'Das Mahnschreiben als PDF-Anhang per E-Mail schicken'
                      }
                    >
                      {amLaufen && laeuft?.was === 'senden' ? (
                        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                      ) : (
                        <SendHorizontal className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {mahnung.status === 'sent' ? 'Erneut senden' : 'Senden'}
                      </span>
                    </Button>
                  )}
                </div>
              )}

              {/* Löschen bleibt der leise Textknopf: Es ist die einzige
                  Aktion hier, die etwas wegnimmt, und sie steht an dem Blatt,
                  um das es geht — also auch dann erreichbar, wenn die
                  Rechnung inzwischen bezahlt ist. */}
              {loeschbar && (
                <button
                  type="button"
                  onClick={() => handleLoeschen(mahnung.id)}
                  disabled={amLaufen}
                  className="mt-1 inline-flex items-center text-xs text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {amLaufen && laeuft?.was === 'loeschen' && (
                    <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  Löschen
                </button>
              )}
            </Zeile>
          )
        })}

        {/* Der Ausblick: gestrichelt, weil es ihn noch nicht gibt. Er steht am
            Ende der Liste, also chronologisch dort, wo die nächste Mahnung
            einmal stehen wird. */}
        {ausblick && (
          <li className="flex items-start gap-3 py-3 last:pb-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600">
              <Clock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </div>
            <p className="min-w-0 flex-1 self-center text-xs text-zinc-500 dark:text-zinc-400">
              {ausblick}
            </p>
          </li>
        )}
      </ul>

      {/* Neue Dokumente entstehen dort, wo die Dokumente stehen. Der Knopf
          sitzt deshalb unter der Liste und nicht im Aktionsstapel weiter
          unten — und weil der Ausblick („1. Mahnung ist ab … vorgesehen")
          direkt darüber endet, steht die Auskunft unmittelbar neben der
          Handlung, die sie auslöst. */}
      {kannHinzufuegen && status && (
        <AddDocument
          invoice={invoice}
          status={status}
          empfaenger={empfaenger}
          absender={absender}
          betont={betont}
          onCreated={onGeaendert}
          onPaid={onPaid}
        />
      )}

      {/* Mahnungen aus der Zeit vor der PDF-Erzeugung. Der Satz steht einmal
          unter der Liste statt in jeder Zeile und hängt an den Daten, nicht an
          einem Merkzettel: Sind alle Mahnungen mit Schreiben entstanden, ist
          er von selbst weg. */}
      {mahnungen.some((mahnung) => !mahnung.pdf_url) && (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Zu älteren Mahnungen gibt es kein PDF — sie entstanden, bevor
          Mahnschreiben als Datei erzeugt wurden. Was gefordert wurde, ist oben
          festgehalten; versenden lassen sie sich nicht mehr.
        </p>
      )}
    </div>
  )
}
