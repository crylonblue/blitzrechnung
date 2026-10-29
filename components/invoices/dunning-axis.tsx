'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { FileCode, FileText, LoaderCircle, SendHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { baueAchse, zusatzForderungen, type AchsenSchritt } from '@/lib/dunning-axis'
import { istMahnbarerBeleg } from '@/lib/dunning-claim'
import { getStatusClass, getStatusLabel } from '@/lib/invoice-utils'
import type { Invoice } from '@/types'
import DunningDrawer from './dunning-drawer'
import {
  legeMahnungAn,
  sendeMahnung,
  verwirfMahnung,
  type DunningStatus,
  type DunningVerlaufEintrag,
} from './dunning-api'

/**
 * Der Mahnweg einer Rechnung als eine Spur — „die Achse".
 *
 * Sie löst die Dokumentenliste ab. Die hatte zwei Mängel, die erst zusammen
 * ins Gewicht fielen: Sie zeigte Dokumente, aber keine Ereignisse (dass eine
 * Frist ablief, stand nirgends), und sie zeigte nur Vergangenes — was als
 * Nächstes käme, hing als Satz darunter. Für eine Leiter, die jede Firma
 * selbst einstellt, ist genau das die wichtigste Auskunft: *und was kommt
 * dann?*
 *
 * Deshalb steht hier alles untereinander, in der Reihenfolge, in der es
 * geschieht. Was war, trägt ein Datum. Was dran ist, trägt den Knopf. Was
 * kommt, steht blass darunter — mit dem Abstand aus der Einstellung und dem,
 * was es zusätzlich fordern wird.
 *
 * **Diese Datei kennt keine Stufennamen.** Jeder Name kommt aus
 * `dunning_stages`. Wer keine Zahlungserinnerung eingerichtet hat, sieht als
 * ersten Mahnschritt seine 1. Mahnung — ohne Lücke und ohne Hinweis darauf,
 * dass anderswo eine Stufe davor üblich wäre. Welcher Schritt wo steht,
 * entscheidet `lib/dunning-axis.ts`; hier wird nur gezeichnet.
 *
 * **Erlauben statt blockieren.** Eine Stufe, die nach dem Zeitplan noch nicht
 * dran ist, hat trotzdem ihren Knopf — die Zeile sagt es nur dazu. Und jede
 * künftige Stufe lässt sich vorziehen, ohne die davor zu überspringen zu
 * müssen.
 */

/** „21. Okt 2026" — dieselbe Schreibweise wie im Kopf der Schublade. */
function tag(iso: string): string {
  // Nicht `new Date(iso)`: Ein ISO-Tag wird als UTC-Mitternacht gelesen und
  // rutscht westlich von Greenwich auf den Vortag.
  const [jahr, monat, t] = iso.split('-').map(Number)
  return format(new Date(jahr, monat - 1, t), 'd. MMM yyyy', { locale: de })
}

/** Heute als ISO-Tag in der Zeitzone des Benutzers. */
function heuteLokal(): string {
  const jetzt = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`
}

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/**
 * Wie lange ein ausgelöster Versand zurückgenommen werden kann.
 *
 * Dreissig Sekunden sind lang genug, um den Schreck zu bemerken („falscher
 * Kunde"), und kurz genug, dass niemand darauf wartet.
 *
 * **Wo diese Frist lebt, und was das bedeutet.** Sie läuft im Browser: Der
 * Aufruf geht erst nach Ablauf hinaus, „Rückgängig" lässt ihn einfach nie
 * stattfinden. Damit nichts verloren geht, wenn der Benutzer vorher weggeht,
 * wird der Auftrag beim Schliessen der Schublade und beim Verlassen der Seite
 * **sofort ausgeführt** statt verworfen — wer „senden" gedrückt hat, soll
 * nicht durch Wegklicken ungewollt nicht gesendet haben.
 *
 * Der ehrliche Weg wäre eine Verzögerung im Dienst: Mahnung anlegen, Versand
 * einreihen, nach dreissig Sekunden ausführen. Dafür fehlt die Warteschlange.
 * Bis dahin bleibt genau ein Fall ungedeckt — der Rechner stürzt in diesen
 * dreissig Sekunden ab. Dann entsteht keine Mahnung, und die Achse sagt beim
 * nächsten Laden die Wahrheit: Es ist nichts geschehen.
 */
const RUECKNAHME_MS = 30_000

// ---------------------------------------------------------------------------
// Der Zustand einer bestehenden Mahnung
// ---------------------------------------------------------------------------

interface Zustand {
  label: string
  klasse: string
  erklaerung: string
}

/**
 * Abgeleitet, nicht gespeichert — in der Datenbank kennt eine Mahnung nur
 * `created` und `sent` (CHECK in Migration 040). **Eine Mahnung wird nie
 * selbst bezahlt**; bezahlt wird die Rechnung, und das färbt auf ihre
 * Schreiben ab. Eine eigene Spalte dafür wäre eine zweite Wahrheit neben
 * `invoices.status`.
 *
 * Die Reihenfolge entscheidet, welcher Zustand gewinnt, und folgt einer Regel:
 * Was über **dieses Blatt** wahr ist, schlägt, was über die **Forderung** wahr
 * ist. Ein erstelltes, nie verschicktes Schreiben bleibt deshalb „Erstellt",
 * auch wenn die Rechnung inzwischen bezahlt ist — man kann es noch löschen,
 * und „Erledigt" würde diesen Knopf zudecken.
 */
function zustandDerMahnung(mahnung: DunningVerlaufEintrag, rechnungsStatus: string): Zustand {
  if (mahnung.superseded_by) {
    return {
      label: 'Ersetzt',
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
// Die Spur
// ---------------------------------------------------------------------------

/**
 * Eine Zeile samt Schiene. Die Schiene ist zwei Striche und ein Punkt; der
 * obere Strich fehlt beim ersten Schritt, der untere beim letzten — sonst
 * stünde die Spur oben und unten über.
 */
function Sprosse({
  erste,
  letzte,
  punkt,
  children,
}: {
  erste: boolean
  letzte: boolean
  punkt: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className={`w-px ${erste ? 'h-1.5' : 'h-1.5 bg-zinc-200 dark:bg-zinc-700'}`} />
        {punkt}
        <span className={`w-px flex-1 ${letzte ? '' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
      </div>
      <div className={letzte ? 'pb-0' : 'pb-5'}>{children}</div>
    </li>
  )
}

/** Die Punkte der Spur — Form und Füllung sagen, in welcher Zeit man ist. */
function Punkt({ art }: { art: AchsenSchritt['art'] }) {
  if (art === 'faellig') {
    return (
      <span className="my-0.5 h-3 w-3 shrink-0 rounded-full bg-zinc-900 ring-4 ring-zinc-900/10 dark:bg-zinc-100 dark:ring-zinc-100/15" />
    )
  }
  if (art === 'kuenftig') {
    // Hohl und gestrichelt: Es gibt ihn noch nicht.
    return (
      <span className="my-1 h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-zinc-400 dark:border-zinc-500" />
    )
  }
  return <span className="my-1 h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
}

// ---------------------------------------------------------------------------
// Der Abschnitt
// ---------------------------------------------------------------------------

interface DunningAxisProps {
  invoice: Invoice
  /** `null` heisst „noch nicht da" — die Rechnungszeile steht trotzdem. */
  status: DunningStatus | null
  hatPdf: boolean
  hatXml: boolean
  onPdf: () => void
  onXml: () => void
  pdfLaedt: boolean
  xmlLaedt: boolean
  /** Nach jeder Änderung: Rechnung und Mahnstatus neu laden. */
  onGeaendert: () => void
  /** Name des Empfängers, von der Schublade schon aufgelöst. */
  empfaenger: string
  /** Name der eigenen Firma — die Unterschrift unter dem Mahnschreiben. */
  absender: string
  /** Darf diese Rechnung überhaupt gemahnt werden? */
  istMahnbar: boolean
  /** Die Mahnschublade meldet „ist längst bezahlt" — die Rechnung geht zu. */
  onPaid: () => void
}

export default function DunningAxis({
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
}: DunningAxisProps) {
  const [laeuft, setLaeuft] = useState<{ id: string; was: 'senden' | 'loeschen' } | null>(null)
  const [ansichtStufe, setAnsichtStufe] = useState<number | null>(null)
  const [schubladeOffen, setSchubladeOffen] = useState(false)
  const [jeGeoeffnet, setJeGeoeffnet] = useState(false)

  /**
   * Gibt es überhaupt eine Adresse?
   *
   * Ohne sie entsteht das Mahnschreiben trotzdem — als PDF zum Ausdrucken,
   * und wer per Post mahnt, ist damit fertig. Was sich ändert, ist die
   * Beschriftung: Ein Knopf, der „senden" verspricht und nur eine Datei
   * anlegt, belügt den Benutzer an der Stelle, an der er am wenigsten damit
   * rechnet.
   */
  const kannMailen = Boolean(invoice.recipient_email || status?.mail?.empfaenger)

  const schritte = useMemo(
    () => (status ? baueAchse(invoice, status, heuteLokal()) : []),
    [invoice, status]
  )

  // ---- Der verzögerte Versand -------------------------------------------
  const [schwebt, setSchwebt] = useState<{ name: string; endet: number; mailt: boolean } | null>(
    null
  )
  const [restSek, setRestSek] = useState(0)
  const auftrag = useRef<{ uhr: ReturnType<typeof setTimeout>; los: () => void } | null>(null)

  const ausfuehren = useCallback(() => {
    const offen = auftrag.current
    if (!offen) return
    clearTimeout(offen.uhr)
    auftrag.current = null
    setSchwebt(null)
    offen.los()
  }, [])

  // Weggehen heisst nicht abbrechen. Beim Ausbauen der Komponente (die
  // Schublade wird geschlossen) und beim Verlassen der Seite geht der Auftrag
  // sofort hinaus — siehe die Begründung an `RUECKNAHME_MS`.
  useEffect(() => {
    const beiVerlassen = () => ausfuehren()
    window.addEventListener('pagehide', beiVerlassen)
    return () => {
      window.removeEventListener('pagehide', beiVerlassen)
      ausfuehren()
    }
  }, [ausfuehren])

  useEffect(() => {
    if (!schwebt) return
    const uhr = setInterval(() => {
      setRestSek(Math.max(0, Math.ceil((schwebt.endet - Date.now()) / 1000)))
    }, 500)
    return () => clearInterval(uhr)
  }, [schwebt])

  /**
   * Senden ohne Zwischenbildschirm.
   *
   * **Hier wird nichts mitgeschickt, was der Benutzer nicht gesehen hat.**
   * Weder der Brief noch Empfänger, Betreff oder Text der E-Mail: Alle vier
   * baut der Server selbst, und zwar aus dem Stand im Augenblick des Versands.
   *
   * Das ist nicht nur weniger Code, sondern die Behebung eines Fehlers. Die
   * Achse hielt bis eben den Empfänger aus `status.mail` fest — einen
   * Schnappschuss vom Öffnen der Schublade. Wer die Adresse darüber änderte,
   * schickte trotzdem an die alte: Beim Versand gewinnt eine mitgeschickte
   * Adresse über die der Rechnung (`versendeMahnung` in
   * `lib/dunning-service.ts`). Ein Wert, den diese Oberfläche nirgends
   * anzeigt, darf einen frischen Wert nicht überstimmen.
   *
   * Wer die Adresse für diesen einen Versand abweichend setzen will, nimmt
   * „Vorher ansehen" — dort steht das Feld, und dort ist das Mitschicken eine
   * Aussage des Benutzers statt eines Nebeneffekts.
   */
  const jetztSenden = (stufenPosition: number, name: string) => {
    if (!status) return
    if (auftrag.current) ausfuehren() // ein zweiter Klick löst den ersten aus

    const los = async () => {
      try {
        const ergebnis = await legeMahnungAn(
          invoice.id,
          { stage: stufenPosition },
          { senden: kannMailen }
        )
        if (ergebnis.versendet) {
          toast.success(`${name} versendet`, { description: `An ${ergebnis.empfaengerEmail}.` })
        } else if (ergebnis.versandFehler) {
          // Zwei Nachrichten in einer: Das Dokument ist da, die E-Mail nicht.
          toast.warning(`${name} erstellt, aber nicht versendet`, {
            description: `${ergebnis.versandFehler} Sie können sie in der Spur erneut senden.`,
          })
        } else {
          toast.success(`${name} erstellt`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Die Mahnung konnte nicht erstellt werden.')
      } finally {
        onGeaendert()
      }
    }

    const uhr = setTimeout(() => {
      auftrag.current = null
      setSchwebt(null)
      void los()
    }, RUECKNAHME_MS)
    auftrag.current = { uhr, los: () => void los() }
    setSchwebt({ name, endet: Date.now() + RUECKNAHME_MS, mailt: kannMailen })
    setRestSek(Math.round(RUECKNAHME_MS / 1000))
  }

  const zuruecknehmen = () => {
    const offen = auftrag.current
    if (!offen) return
    clearTimeout(offen.uhr)
    auftrag.current = null
    const offenerName = schwebt?.name ?? 'Das Schreiben'
    const mailte = schwebt?.mailt ?? true
    setSchwebt(null)
    toast.info(mailte ? `${offenerName} wurde nicht versendet.` : `${offenerName} wurde nicht erstellt.`)
  }

  // ---- Bestehende Schreiben ---------------------------------------------
  const erneutSenden = async (reminderId: string, name: string) => {
    setLaeuft({ id: reminderId, was: 'senden' })
    try {
      const { empfaengerEmail } = await sendeMahnung(reminderId)
      toast.success(`${name} versendet`, { description: `An ${empfaengerEmail}.` })
      onGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Die Mahnung konnte nicht versendet werden.')
    } finally {
      setLaeuft(null)
    }
  }

  const loeschen = async (reminderId: string) => {
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

  const oeffneAnsicht = (stufenPosition: number) => {
    setAnsichtStufe(stufenPosition)
    setJeGeoeffnet(true)
    setSchubladeOffen(true)
  }

  // Die Knöpfe zu PDF und XML der Rechnung. Hängen sonst an der Sprosse der
  // Rechnung — eine Stornorechnung hat keinen Mahnverlauf und damit keine
  // Sprosse, ihre Dateien will man trotzdem ansehen können.
  const dateien = (hatPdf || hatXml) && (
    <div className="mt-2 flex gap-2">
      {hatPdf && (
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 flex-1"
          onClick={onPdf}
          disabled={pdfLaedt}
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
          title="Rechnung als XRechnung im XML-Format herunterladen"
        >
          <FileCode className="h-4 w-4 shrink-0" />
          <span className="truncate">{xmlLaedt ? 'Lädt...' : 'XML (XRechnung)'}</span>
        </Button>
      )}
    </div>
  )

  // Ohne Datei und ohne einen einzigen Schritt gäbe es nur eine Überschrift.
  if (schritte.length === 0 && !hatPdf && !hatXml) return null

  // Eine Stornorechnung wird nicht gemahnt: kein Verlauf, nur ihre Dateien.
  if (!istMahnbarerBeleg(invoice)) {
    if (!dateien) return null
    return (
      <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Dokumente
        </h3>
        {dateien}
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Verlauf
      </h3>

      <ol className="flex flex-col">
        {schritte.map((schritt, i) => {
          const erste = i === 0
          const letzte = i === schritte.length - 1
          const punkt = <Punkt art={schritt.art} />

          // ---- Die Rechnung selbst ----
          if (schritt.art === 'rechnung') {
            return (
              <Sprosse key={schritt.schluessel} erste={erste} letzte={letzte} punkt={punkt}>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {schritt.titel}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {schritt.tag ? tag(schritt.tag) : 'ohne Datum'} ·{' '}
                  {euro.format(schritt.betrag ?? 0)}
                </p>
                {dateien}
                {!hatPdf && !hatXml && (
                  <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    Zu dieser Rechnung ist noch keine Datei erzeugt worden.
                  </p>
                )}
              </Sprosse>
            )
          }

          // ---- Der Fristablauf ----
          if (schritt.art === 'frist') {
            return (
              <Sprosse key={schritt.schluessel} erste={erste} letzte={letzte} punkt={punkt}>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{schritt.titel}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {schritt.tag ? tag(schritt.tag) : ''} · seit{' '}
                  {schritt.verzugsTage === 1 ? 'einem Tag' : `${schritt.verzugsTage} Tagen`} im
                  Verzug
                </p>
              </Sprosse>
            )
          }

          // ---- Ein bestehendes Schreiben ----
          if (schritt.art === 'mahnung' && schritt.mahnung) {
            const mahnung = schritt.mahnung as DunningVerlaufEintrag
            const zustand = zustandDerMahnung(mahnung, invoice.status)
            const gilt = !mahnung.superseded_by
            // Löschen nur, solange nichts hinausging: Ein verschicktes
            // Schreiben ist ein Handelsbrief und bleibt.
            const loeschbar = gilt && mahnung.status === 'created'
            const sendbar = gilt && Boolean(mahnung.pdf_url) && istMahnbar
            const amLaufen = laeuft?.id === mahnung.id

            return (
              <Sprosse key={schritt.schluessel} erste={erste} letzte={letzte} punkt={punkt}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {schritt.titel}
                  </p>
                  <span className={`${zustand.klasse} shrink-0`} title={zustand.erklaerung}>
                    {zustand.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {schritt.tag ? tag(schritt.tag) : ''} · {euro.format(mahnung.total_amount)}
                </p>
                {(mahnung.pdf_url || sendbar) && (
                  <div className="mt-2 flex gap-2">
                    {mahnung.pdf_url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-w-0 flex-1"
                        onClick={() => window.open(mahnung.pdf_url as string, '_blank')}
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
                        onClick={() => erneutSenden(mahnung.id, mahnung.stage_name)}
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
                {loeschbar && (
                  <button
                    type="button"
                    onClick={() => loeschen(mahnung.id)}
                    disabled={amLaufen}
                    className="mt-1 inline-flex items-center text-xs text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {amLaufen && laeuft?.was === 'loeschen' && (
                      <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    Löschen
                  </button>
                )}
              </Sprosse>
            )
          }

          // ---- Die fällige Stufe: der eine Schritt mit dem Knopf ----
          if (schritt.art === 'faellig' && schritt.stufe) {
            const stufe = schritt.stufe
            const f = schritt.forderung
            const posten: string[] = []
            if (f && f.zinsen > 0) posten.push(`${euro.format(f.zinsen)} Zinsen`)
            if (f && f.pauschale > 0) posten.push(`${euro.format(f.pauschale)} Pauschale`)
            if (f && f.gebuehr > 0) posten.push(`${euro.format(f.gebuehr)} Gebühr`)

            return (
              <Sprosse key={schritt.schluessel} erste={erste} letzte={letzte} punkt={punkt}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {schritt.titel}
                  </p>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {/* „vorgesehen ab" statt „möglich ab": Früher mahnen ist
                        erlaubt; das Datum sagt nur, wann die Stufe nach dem
                        eingerichteten Zeitplan an der Reihe ist. */}
                    {schritt.istFaellig
                      ? schritt.tag
                        ? `seit ${tag(schritt.tag)} fällig`
                        : 'jetzt fällig'
                      : schritt.tag
                        ? `ab ${tag(schritt.tag)} vorgesehen`
                        : 'noch nicht vorgesehen'}
                  </span>
                </div>

                {f && (
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Fordert{' '}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {euro.format(f.summe)}
                    </span>
                    {posten.length > 0
                      ? ` — Rechnung, ${posten.join(', ')}`
                      : ' — nur die Rechnung'}
                    . Neue Frist bis {tag(f.neueFrist)}.
                  </p>
                )}

                {schwebt ? (
                  <div className="mt-2 flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60">
                    <p className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-300">
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {schwebt.name}
                      </span>{' '}
                      {schwebt.mailt ? 'geht hinaus' : 'wird erstellt'} — noch {restSek} Sek.
                    </p>
                    <button
                      type="button"
                      onClick={zuruecknehmen}
                      className="shrink-0 text-xs font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-50 dark:hover:text-zinc-300"
                    >
                      Rückgängig
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="min-w-0 flex-1"
                      disabled={!f}
                      onClick={() => jetztSenden(stufe.position, stufe.name)}
                      title={
                        kannMailen
                          ? `${stufe.name} erstellen und als PDF-Anhang per E-Mail verschicken`
                          : `${stufe.name} als PDF erstellen — zum Ausdrucken und Versenden per Post`
                      }
                    >
                      <SendHorizontal className="h-4 w-4 shrink-0" />
                      <span className="truncate">{kannMailen ? 'Jetzt senden' : 'Jetzt erstellen'}</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1"
                      onClick={() => oeffneAnsicht(stufe.position)}
                      title="Das Schreiben ansehen und bei Bedarf ändern, bevor es hinausgeht"
                    >
                      <span className="truncate">Vorher ansehen</span>
                    </Button>
                  </div>
                )}

                {!kannMailen && (
                  <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    Für diesen Empfänger ist keine E-Mail-Adresse hinterlegt. Das Schreiben
                    entsteht als PDF zum Ausdrucken.
                  </p>
                )}

                {!schritt.istFaellig && (
                  <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    Nach Ihrem Zeitplan ist diese Stufe noch nicht an der Reihe. Sie können
                    trotzdem mahnen.
                  </p>
                )}
              </Sprosse>
            )
          }

          // ---- Was danach käme ----
          if (schritt.art === 'kuenftig' && schritt.stufe) {
            const stufe = schritt.stufe
            const zusatz = zusatzForderungen(stufe)
            return (
              <Sprosse key={schritt.schluessel} erste={erste} letzte={letzte} punkt={punkt}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm text-zinc-500 dark:text-zinc-400">
                    {schritt.titel}
                  </p>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {stufe.tageNachVorstufe === 0
                      ? 'unmittelbar danach'
                      : `${stufe.tageNachVorstufe} Tage später`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                  {zusatz.length > 0
                    ? `fordert zusätzlich ${zusatz.join(' und ')}`
                    : 'ohne Zusatzforderung'}
                </p>
                <button
                  type="button"
                  onClick={() => oeffneAnsicht(stufe.position)}
                  className="mt-1 text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Vorziehen
                </button>
              </Sprosse>
            )
          }

          return null
        })}
      </ol>

      {/* Mahnungen aus der Zeit vor der PDF-Erzeugung. Der Satz hängt an den
          Daten, nicht an einem Merkzettel: Sind alle Schreiben mit Datei
          entstanden, ist er von selbst weg. */}
      {(status?.verlauf.length ?? 0) > 0 &&
        status!.verlauf.some((mahnung) => !mahnung.pdf_url) && (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            Zu älteren Mahnungen gibt es kein PDF — sie entstanden, bevor Mahnschreiben als Datei
            erzeugt wurden. Was gefordert wurde, ist oben festgehalten; versenden lassen sie sich
            nicht mehr.
          </p>
        )}

      {/* „Vorher ansehen" und „Vorziehen" führen in dieselbe Schublade; sie
          unterscheiden sich nur darin, welche Stufe vorgewählt ist. Erst bei
          Bedarf einhängen, dann aber eingehängt lassen — die Schublade bringt
          ihre eigene Öffnungsbewegung mit, und ein Ausbauen beim Schliessen
          schnitte sie ab. */}
      {jeGeoeffnet && status && (
        <DunningDrawer
          invoice={invoice}
          empfaenger={empfaenger}
          absender={absender}
          basis={status}
          startStufe={ansichtStufe}
          isOpen={schubladeOffen}
          onClose={() => setSchubladeOffen(false)}
          onCreated={onGeaendert}
          onPaid={onPaid}
        />
      )}
    </div>
  )
}
