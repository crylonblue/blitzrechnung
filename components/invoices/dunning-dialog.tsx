'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, CircleCheck, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { formatCurrencyForLanguage, formatDateForLanguage } from '@/lib/invoice-translations'
import type { InterestResult } from '@/lib/dunning-interest'
import type { Invoice } from '@/types'
import {
  istUnveraendert,
  ladeMahnstatus,
  legeMahnungAn,
  type DunningAnpassung,
  type DunningCustomerType,
  type DunningStatus,
} from './dunning-api'

/**
 * Der Prüfbildschirm.
 *
 * Kein Formular: Was aufgeht, ist das fertige Ergebnis. Jede Frage, die hier
 * gestellt würde, kostet beim ersten Mahnen genau die Entschlossenheit, die
 * man zum Mahnen braucht — und die allermeisten Antworten kennt der Server
 * ohnehin. Gefragt wird deshalb nur noch das eine, was er nicht wissen kann
 * und was den Betrag verändert (Unternehmer oder Verbraucher), und auch das
 * nur dann, wenn es den Betrag wirklich verändert.
 *
 * Die Hauptsache ist der Brief: Er steht oben und nimmt den meisten Platz,
 * weil er das ist, was beim Kunden ankommt. Die Zahlen tragen ihn als
 * schmaler Streifen von unten — sie sind die Kontrolle, nicht das Ergebnis.
 *
 * Alles Verstellbare liegt hinter „Anpassen" — eingeklappt, bis auf den einen
 * Fall, in dem der Nutzer etwas bestätigen muss (siehe `startetOffen`); was
 * abweicht, nennt die zugeklappte Zeile trotzdem beim Namen. Das Muster
 * (natives `<details>/<summary>`) stammt aus
 * `components/drafts/draft-editor.tsx`; dort steckt die manuelle
 * Rechnungsnummer im selben Aufbau.
 */

const EUR = (betrag: number) => formatCurrencyForLanguage(betrag, 'de')
const TAG = (iso: string) => formatDateForLanguage(iso, 'de')
const PROZENT = (wert: number) => wert.toLocaleString('de-DE', { maximumFractionDigits: 2 })

/**
 * Die Klammer hinter „Verzugszinsen": Aufschlag, erster Zinstag, Zinstage.
 *
 * Der Aufschlag und nicht der volle Satz, weil der Basiszinssatz sich
 * halbjährlich ändert und der Aufschlag die Aussage ist, die aus dem Gesetz
 * kommt (fünf bzw. neun Punkte, § 288 BGB). Tragen die Abschnitte
 * verschiedene Sätze — eine Forderung, die über den 1. Januar oder 1. Juli
 * hinweg offen ist —, wird das gesagt statt eine Zahl zu erfinden: ein
 * Durchschnitt sähe aus wie eine Feststellung und wäre keine.
 */
function zinsErlaeuterung(zinsDetails: InterestResult | null): string | null {
  const abschnitte = zinsDetails?.segments ?? []
  if (abschnitte.length === 0) return null

  const einSatz = new Set(abschnitte.map((a) => a.ratePercent)).size === 1
  const aufschlag = abschnitte[0].ratePercent - abschnitte[0].baseRate
  const satz = einSatz ? `${PROZENT(aufschlag)} % über Basiszins` : 'mehrere Zinssätze'
  const tage = zinsDetails!.days
  return `${satz}, seit ${TAG(abschnitte[0].from)}, ${tage} ${tage === 1 ? 'Tag' : 'Tage'}`
}

/**
 * Der Tag, an dem die Rechnung nach ihrem eigenen Text fällig **wird** — oder
 * `null`, wenn dieser Tag schon vorbei ist oder gar keiner hinterlegt ist.
 *
 * Das ist die Unterscheidung, an der dieser Dialog zwei grundverschiedene
 * Schreiben auseinanderhält: die Mahnung nach Fälligkeit und die freundliche
 * Erinnerung davor.
 *
 * Warum `invoice.due_date` und nicht `status.verzugsbeginn`: Der
 * Verzugsbeginn ist der spätere von Fälligkeit und Rechnungsdatum + 30 Tage
 * (§ 286 Abs. 3 BGB, siehe `lib/dunning-claim.ts`) — eine Rechengrösse für
 * Zinsen. Der Empfänger kennt sie nicht; er kennt das Datum, das auf seiner
 * Rechnung steht. Ein Schreiben, das ihn an eine Frist erinnert, muss von
 * genau dieser sprechen.
 *
 * Der Verzugsbeginn bleibt trotzdem die **Vorbedingung**: Trägt der Nutzer
 * unter „Anpassen" ein nachweislich vereinbartes, früheres Zahlungsziel ein,
 * rechnet der Server Verzug und Zinsen — dann ist dies keine Vorab-Erinnerung
 * mehr, und die Aufstellung daneben würde dem freundlichen Text widersprechen.
 * Dieselbe Grenze wie in `lib/dunning-claim.ts`: Verzug besteht erst **nach**
 * Ablauf des Tages (§ 187 Abs. 1 BGB), deshalb `>` und nicht `>=`.
 *
 * „Heute" als UTC-Tag, wie es auch die Route tut (`heute()` in
 * `app/api/invoices/[id]/dunning/route.ts`) — so fällt diese Einschätzung mit
 * dem Stichtag zusammen, auf den der Server gerechnet hat.
 */
function faelligkeitNochVoraus(invoice: Invoice, verzugsbeginn: string): string | null {
  if (!invoice.due_date) return null
  const heute = new Date().toISOString().split('T')[0]
  if (heute > verzugsbeginn) return null
  return heute < invoice.due_date ? invoice.due_date : null
}

/**
 * Die Frist, die das Schreiben tatsächlich einräumt.
 *
 * `forderung.neueFrist` ist Stichtag + `grace_days` der Stufe. Nach
 * Fälligkeit ist das genau richtig: eine Nachfrist auf eine Zahlung, die
 * längst hätte kommen müssen.
 *
 * **Vor** Fälligkeit geht die Rechnung nicht auf. Bei sieben Nachfristtagen
 * und einer Rechnung, die erst in drei Wochen fällig wird, stünde in der
 * Erinnerung ein Termin **vor** dem, den die Rechnung selbst nennt — das
 * Schreiben verlangte früher Geld, als der Empfänger es schuldet. Und auch
 * der umgekehrte Fall taugt nicht: Wird die Rechnung übermorgen fällig,
 * verschöbe „Stichtag + 7" den Termin um fünf Tage nach hinten; die
 * Erinnerung räumte also mehr Zeit ein, als der Erinnernde geben wollte.
 *
 * Beides kommt daher, dass `grace_days` eine **Nachfrist** ist — ein Begriff,
 * der vor Fälligkeit keinen Gegenstand hat. Vor Fälligkeit gibt es nur eine
 * Frist, und die steht bereits auf der Rechnung. Die Erinnerung verweist
 * darauf; sie setzt keine neue.
 *
 * Hinweis für später: Der Server friert weiterhin `neueFrist` in
 * `payment_reminders.due_date` ein. Das ist ausserhalb dieser Datei und
 * gemeldet.
 */
function zahlungsfrist(neueFrist: string, nochNichtFaellig: string | null): string {
  return nochNichtFaellig ?? neueFrist
}

interface SchreibenInput {
  invoice: Invoice
  /** Name der eigenen Firma — die Unterschrift unter dem Schreiben. */
  absender: string
  status: DunningStatus
}

/**
 * Das vorbereitete Schreiben.
 *
 * Die Stufe bestimmt den Ton, nicht der Nutzer: Eine Zahlungserinnerung
 * unterstellt ein Versehen, eine Mahnung stellt den Verzug fest, die letzte
 * nennt die Folge. Wer es anders haben will, schreibt im Textfeld darüber —
 * deshalb ist es ein Textfeld und keine Vorschau.
 */
function baueSchreiben({ invoice, absender, status }: SchreibenInput): string {
  const forderung = status.forderung
  if (!forderung || !status.stufe) return ''

  const nummer = invoice.invoice_number || 'ohne Nummer'
  const rechnungsdatum = invoice.invoice_date ? TAG(invoice.invoice_date) : null
  const vom = rechnungsdatum ? ` vom ${rechnungsdatum}` : ''
  const position = status.stufe.position

  // Allgemeine Anrede: Der Empfänger-Snapshot trägt einen Firmennamen, keine
  // Ansprechperson — „Sehr geehrte Muster GmbH" wäre falsch.
  const anrede = 'Sehr geehrte Damen und Herren,'

  const nochNichtFaellig = faelligkeitNochVoraus(invoice, status.verzugsbeginn)

  /**
   * Vor Fälligkeit **ein** Text, unabhängig von der Stufe.
   *
   * Die Stufen drücken eine Eskalation aus, und eine Eskalation setzt voraus,
   * dass etwas ausgeblieben ist. Vor dem Fälligkeitstag ist nichts
   * ausgeblieben: Der Empfänger darf bis dahin zahlen und hat dieses Recht
   * nicht dadurch verwirkt, dass wir ihn früh anschreiben. Jeder der drei
   * bisherigen Einstiege wäre hier unwahr — „ist fällig und noch nicht
   * eingegangen" ebenso wie „Sie befinden sich in Verzug". Deshalb tritt vor
   * Fälligkeit eine einzige, freundliche Formulierung an ihre Stelle: Sie
   * erinnert an den bevorstehenden Termin und stellt nichts fest.
   *
   * Die Texte **nach** Fälligkeit bleiben Wort für Wort, wie sie waren.
   */
  const einstieg = nochNichtFaellig
    ? `unsere Rechnung ${nummer}${vom} über ${EUR(forderung.offenerBetrag)} wird am ${TAG(nochNichtFaellig)} fällig. Mit diesem Schreiben möchten wir Sie vorab freundlich daran erinnern.`
    : position === 1
      // Faellig ist die Rechnung an ihrem eigenen Termin, nicht am
      // Verzugsbeginn. Die beiden fallen auseinander, sobald der
      // 30-Tage-Boden aus § 286 Abs. 3 BGB greift — bei einem verkuerzten
      // Zahlungsziel liegt der Verzugsbeginn Wochen nach der Faelligkeit.
      // Hier stand bisher der Verzugsbeginn, das Schreiben nannte dem
      // Empfaenger also ein Datum, an dem seine Rechnung nicht faellig war.
      // Stufe 2 und 3 unten benutzen den Verzugsbeginn dagegen richtig:
      // dort geht es um Verzug, nicht um Faelligkeit.
      ? `unsere Rechnung ${nummer}${vom} über ${EUR(forderung.offenerBetrag)} war am ${TAG(invoice.due_date ?? status.verzugsbeginn)} zur Zahlung fällig und ist bei uns noch nicht eingegangen. Vermutlich ist sie in Ihrem Haus untergegangen.`
      : position === 2
        ? `trotz unserer Zahlungserinnerung ist unsere Rechnung ${nummer}${vom} über ${EUR(forderung.offenerBetrag)} bis heute nicht ausgeglichen. Sie befinden sich seit dem ${TAG(status.verzugsbeginn)} in Verzug.`
        : `auf unsere bisherigen Schreiben haben Sie nicht reagiert. Unsere Rechnung ${nummer}${vom} über ${EUR(forderung.offenerBetrag)} ist weiterhin offen; Sie befinden sich seit dem ${TAG(status.verzugsbeginn)} in Verzug.`

  // Die Aufstellung nur dann, wenn mehr als die Hauptforderung im Spiel ist —
  // bei einer reinen Zahlungserinnerung wäre eine zweizeilige Tabelle mit
  // identischen Beträgen eine Behauptung von Komplexität.
  const posten: string[] = []
  if (forderung.zinsen > 0 || forderung.gebuehr > 0 || forderung.pauschale > 0) {
    posten.push(`Offener Betrag: ${EUR(forderung.offenerBetrag)}`)
    if (forderung.zinsen > 0) posten.push(`Verzugszinsen: ${EUR(forderung.zinsen)}`)
    if (forderung.gebuehr > 0) posten.push(`Mahnkosten: ${EUR(forderung.gebuehr)}`)
    if (forderung.pauschale > 0)
      posten.push(`Pauschale nach § 288 Abs. 5 BGB: ${EUR(forderung.pauschale)}`)
    posten.push(`Gesamtforderung: ${EUR(forderung.summe)}`)
  }

  const bitte = `Wir bitten Sie, ${
    posten.length > 0 ? 'den Gesamtbetrag' : `den Betrag von ${EUR(forderung.summe)}`
  } bis zum ${TAG(zahlungsfrist(forderung.neueFrist, nochNichtFaellig))} auf das unten genannte Konto zu überweisen.`

  // Die Ankündigung des gerichtlichen Schritts setzt voraus, dass die Zahlung
  // überhaupt schon geschuldet ist. Vor Fälligkeit ist sie gegenstandslos —
  // und als Drohung gegenüber jemandem, der noch gar nicht zahlen muss, das
  // Gegenteil der freundlichen Erinnerung, als die dieses Schreiben gedacht
  // ist.
  const folge =
    position >= 3 && !nochNichtFaellig
      ? 'Geht die Zahlung bis dahin nicht ein, geben wir die Forderung ohne weitere Ankündigung zur gerichtlichen Geltendmachung ab.'
      : null

  // Die Überschneidungsklausel bleibt auf jeder Stufe stehen: Sie kostet eine
  // Zeile und erspart dem Empfänger, der gestern überwiesen hat, den Anruf.
  const ueberschneidung =
    'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.'

  const absaetze = [
    anrede,
    einstieg,
    posten.length > 0 ? posten.join('\n') : null,
    bitte,
    folge,
    ueberschneidung,
    `Mit freundlichen Grüßen\n${absender}`,
  ].filter(Boolean)

  return absaetze.join('\n\n')
}

/**
 * Startet „Anpassen" offen?
 *
 * Genau ein Fall: Der Basiszinssatz ist fortgeschrieben statt geprüft
 * (`stale`). Dann steht im Brief eine Zinszahl, für die niemand geradesteht —
 * bestreitet der Schuldner sie, ist die Forderung angreifbar, und das Feld,
 * um den Satz zu bestätigen, liegt in diesem Bereich. Der Server setzt
 * `stale` ohnehin nur, wenn tatsächlich Zinsen gerechnet wurden (siehe
 * `lib/dunning-claim.ts`); ohne Zinsen gibt es nichts zu bestätigen.
 *
 * Was hier bewusst **nicht** mehr steht — beides riss den Bereich vorher auf,
 * ohne dass der Nutzer etwas hätte entscheiden müssen:
 *
 *  * Verzugsbeginn ≠ Fälligkeit. Das ist der 30-Tage-Boden aus § 286 Abs. 3
 *    BGB, also das *richtige* Datum. Es trifft jedes verkürzte Zahlungsziel
 *    und war damit fast der Normalfall. Bestätigen muss man nichts, was
 *    stimmt — erklären schon, und das tut die zugeklappte Zeile.
 *  * Die Stufe ist noch nicht fällig. Die Wartezeit zwischen zwei Schreiben
 *    ist unsere eigene Einstellung und keine Rechtsfrage: Früher zu erinnern
 *    macht die Forderung nicht angreifbar.
 *
 * Unsichtbar wird dadurch nichts: Was abweicht, nennt `abweichungen` in der
 * zugeklappten Zeile.
 */
function startetOffen(stand: DunningStatus): boolean {
  return stand.stale
}

interface DunningDialogProps {
  invoice: Invoice
  /** Name des Empfängers, so wie ihn die Schublade schon aufgelöst hat. */
  empfaenger: string
  /** Name der eigenen Firma — die Unterschrift unter dem Schreiben. */
  absender: string
  /** Der ungefilterte Serverstand, bereits von der Schublade geholt. */
  basis: DunningStatus
  isOpen: boolean
  onClose: () => void
  /** Entwurf angelegt — die Schublade lädt Rechnung und Verlauf neu. */
  onCreated: () => void
  /** Rechnung ist bezahlt — die Schublade schliesst sich. */
  onPaid: () => void
}

export default function DunningDialog({
  invoice,
  empfaenger,
  absender,
  basis,
  isOpen,
  onClose,
  onCreated,
  onPaid,
}: DunningDialogProps) {
  const router = useRouter()
  const supabase = createClient()

  const [anpassung, setAnpassung] = useState<DunningAnpassung>({})
  const [status, setStatus] = useState<DunningStatus>(basis)
  const [istAmRechnen, setIstAmRechnen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [istAmSpeichern, setIstAmSpeichern] = useState(false)
  const [istAmBezahlen, setIstAmBezahlen] = useState(false)

  const [text, setText] = useState('')
  // Sobald der Nutzer den Text angefasst hat, wird er nicht mehr überschrieben:
  // eine Anpassung an den Zahlen darf keine getippte Zeile wegwerfen.
  const [textVomNutzer, setTextVomNutzer] = useState(false)

  const [anpassenOffen, setAnpassenOffen] = useState(false)

  // Der Basiszinssatz als Rohtext. Eine Zahl im Zustand würde „1," und „1."
  // beim Tippen sofort wegräumen; die Zahl daneben in `anpassung` ist das,
  // womit gerechnet wird.
  const [basiszinsText, setBasiszinsText] = useState('')

  /**
   * Einmal gefragt, bleibt gefragt.
   *
   * Die Antwort ändert den Betrag — und kann dadurch den Grund wegnehmen, aus
   * dem gefragt wurde (wer „Privatperson" wählt, verliert die 40 € und damit
   * womöglich den letzten Posten neben der Hauptforderung). Verschwände die
   * Auswahl in diesem Moment, liesse sich eine versehentliche Antwort nicht
   * mehr zurücknehmen.
   */
  const [kundentypGefragt, setKundentypGefragt] = useState(false)

  // Beim Öffnen auf den Stand zurück, den die Schublade geholt hat. Ein Dialog,
  // der die Einstellungen des letzten Males noch trägt, mahnt beim zweiten Mal
  // anders als beim ersten, ohne dass jemand etwas geändert hätte.
  useEffect(() => {
    if (!isOpen) return
    setAnpassung({})
    setStatus(basis)
    setFehler(null)
    setTextVomNutzer(false)
    setBasiszinsText('')
    setKundentypGefragt(false)
    setAnpassenOffen(startetOffen(basis))
  }, [isOpen, basis])

  // Der Schlüssel macht aus dem Objekt eine vergleichbare Zeichenkette — sonst
  // liefe der Effekt bei jedem Rendern erneut.
  const anpassungsSchluessel = JSON.stringify(anpassung)

  useEffect(() => {
    if (!isOpen) return
    const eingestellt: DunningAnpassung = JSON.parse(anpassungsSchluessel)
    if (istUnveraendert(eingestellt)) {
      setStatus(basis)
      setIstAmRechnen(false)
      return
    }

    const controller = new AbortController()
    setIstAmRechnen(true)

    // Kurz warten, bevor gerechnet wird: Ein getippter Zinssatz schickt sonst
    // je Anschlag eine Anfrage los, und die Beträge flackern beim Tippen.
    const timer = setTimeout(() => {
      ladeMahnstatus(invoice.id, eingestellt, controller.signal)
        .then((neu) => {
          setStatus(neu)
          setFehler(null)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setFehler(
            err instanceof Error ? err.message : 'Die Forderung konnte nicht neu berechnet werden.'
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setIstAmRechnen(false)
        })
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [isOpen, anpassungsSchluessel, invoice.id, basis])

  // Der Text folgt den Zahlen, solange niemand ihn angefasst hat.
  useEffect(() => {
    if (!isOpen || textVomNutzer) return
    setText(baueSchreiben({ invoice, absender, status }))
  }, [isOpen, textVomNutzer, invoice, absender, status])

  const textfeld = useRef<HTMLTextAreaElement | null>(null)

  /**
   * Das Textfeld misst sich an seinem Inhalt.
   *
   * Die vorbereiteten Schreiben sind in der Dialogbreite je nach Stufe rund
   * 14 bis 24 Zeilen lang: am kürzesten die Zahlungserinnerung ohne
   * Aufstellung, am längsten die letzte Mahnung mit allen Posten und einem
   * langen Firmennamen. Bei `rows={10}` endete der Text deshalb ohne jedes
   * Zeichen dafür, dass es weitergeht. Eine feste Höhe für den längsten Fall
   * stünde im Regelfall halb leer im Weg — also wächst das Feld mit und hört
   * an einer Grenze auf (`max-h` an der Klasse: 22 rem, rund 15 Zeilen).
   *
   * Warum diese Grenze und nicht mehr: Der Dialog ist auf 42 rem gedeckelt;
   * Kopf, Fusszeile und Innenabstand nehmen davon rund 12 rem. Ein Feld, das
   * darüber hinauswüchse, verdrängte die Zahlen darunter aus dem Bild und
   * machte den Dialog zu einem Textfeld mit Rahmen. Ab der Grenze rollt das
   * Feld in sich — was in aller Regel nur noch den selbst getippten Langbrief
   * trifft, nicht mehr den vorbereiteten Text.
   */
  useEffect(() => {
    const feld = textfeld.current
    if (!feld) return
    // Erst zurücksetzen: `scrollHeight` wüsste sonst nur von der bisherigen
    // Höhe, und das Feld könnte nach dem Löschen von Zeilen nie schrumpfen.
    feld.style.height = 'auto'
    // `scrollHeight` kennt Innenabstand und Inhalt, nicht den Rahmen — bei
    // `border-box` fehlten sonst zwei Pixel und es erschiene ein Rollbalken.
    const rahmen = feld.offsetHeight - feld.clientHeight
    feld.style.height = `${feld.scrollHeight + rahmen}px`
  }, [isOpen, text])

  /**
   * Die Stufen, die zur Auswahl stehen.
   *
   * Benennbar ist nur, was der Server benannt hat: die Stufen aus dem Verlauf
   * und die nächste fällige. Weitere mag es geben — sie zu erraten und mit
   * einem ausgedachten Namen anzubieten wäre schlimmer, als sie wegzulassen.
   * Grundlage ist bewusst `basis` und nicht `status`: Sonst wechselte die
   * Liste, sobald man in ihr etwas auswählt.
   */
  const stufenOptionen = useMemo(() => {
    const nachPosition = new Map<number, string>()
    for (const eintrag of basis.verlauf) nachPosition.set(eintrag.stage_position, eintrag.stage_name)
    if (basis.stufe) nachPosition.set(basis.stufe.position, basis.stufe.name)
    return [...nachPosition.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([position, name]) => ({ position, name }))
  }, [basis])

  const forderung = status.forderung

  // Dieselbe Frage wie im Schreiben: Steht die Fälligkeit der Rechnung noch
  // bevor? Dann ist dies eine Erinnerung und keine Mahnung.
  const nochNichtFaellig = faelligkeitNochVoraus(invoice, status.verzugsbeginn)

  /**
   * Gibt es überhaupt etwas aufzuschlüsseln?
   *
   * Ohne Zinsen, Gebühr und Pauschale ist die Gesamtforderung der offene
   * Betrag — zwei Zeilen mit derselben Zahl behaupten eine Rechnung, die nicht
   * stattfindet. Und das ist kein Randfall: Stufe 1 sieht nichts davon vor,
   * eine Zahlungserinnerung landet also immer hier. `baueSchreiben` trifft
   * dieselbe Unterscheidung für den Brieftext.
   */
  const hatZusaetze =
    forderung !== null &&
    (forderung.zinsen > 0 || forderung.gebuehr > 0 || forderung.pauschale > 0)

  /**
   * Unternehmer oder Verbraucher — nur fragen, wenn es den Betrag ändert.
   *
   * Der Typ entscheidet über den Zinsaufschlag (5 statt 9 Punkte, § 288 Abs. 1
   * und 2 BGB) und über die 40-€-Pauschale (§ 288 Abs. 5 BGB, nur gegenüber
   * Nicht-Verbrauchern). Steht beides nicht im Raum — eine Zahlungserinnerung
   * ohne Zinsen und ohne Pauschale —, ändert die Antwort nichts, und dann ist
   * die Frage reine Reibung. Im Kontaktformular steht sie aus demselben Grund
   * nicht: Dort träfe sie auch alle, die nie mahnen.
   */
  useEffect(() => {
    if (!isOpen) return
    const noetig =
      status.customerType === null &&
      status.forderung !== null &&
      (status.forderung.zinsen > 0 || status.forderung.pauschale > 0)
    if (noetig) setKundentypGefragt(true)
  }, [isOpen, status])

  const zinsText = zinsErlaeuterung(status.zinsDetails)
  const zinsenAn = anpassung.interest ?? (status.zinsDetails?.segments.length ?? 0) > 0

  /**
   * Die Zahlen als Streifen, nicht als Tabelle.
   *
   * Die Hauptsache dieses Dialogs ist der Brief — er ist das, was beim Kunden
   * ankommt und was geprüft werden will. Die Aufstellung stand vorher als
   * mehrzeilige Tabelle darüber und nahm im Regelfall (Zahlungserinnerung,
   * keine Zinsen, keine Pauschale) den halben oberen Rand für genau zwei
   * Zahlen ein. Sie steht deshalb jetzt **unter** dem Brief, und jeder Posten
   * ist ein schmales Paar aus Beschriftung und Wert: Es passen mehrere in
   * eine Zeile, und im Regelfall ist der ganze Streifen eine einzige.
   *
   * Verloren geht dabei nichts — dieselben Posten in derselben Reihenfolge,
   * die Gesamtforderung hervorgehoben, weil sie die Aussage ist und die
   * übrigen nur ihre Herkunft. Zinserläuterung und der Hinweis zur Frist
   * stehen als Fussnoten darunter weiter.
   */
  const kennzahlen = useMemo(() => {
    if (!forderung) return []
    const liste: { label: string; wert: string; stark?: boolean }[] = []
    if (hatZusaetze) {
      liste.push({ label: 'Offener Betrag', wert: EUR(forderung.offenerBetrag) })
      if (forderung.zinsen > 0) liste.push({ label: 'Verzugszinsen', wert: EUR(forderung.zinsen) })
      if (forderung.gebuehr > 0) liste.push({ label: 'Mahnkosten', wert: EUR(forderung.gebuehr) })
      if (forderung.pauschale > 0)
        liste.push({ label: 'Pauschale § 288 Abs. 5', wert: EUR(forderung.pauschale) })
    }
    liste.push({ label: 'Gesamtforderung', wert: EUR(forderung.summe), stark: true })
    liste.push({
      // Vor Fälligkeit ist die Frist nicht „neu" — sie steht unverändert auf
      // der Rechnung. Die Begründung steht bei `zahlungsfrist`.
      label: nochNichtFaellig ? 'Zahlungsfrist der Rechnung' : 'Neue Zahlungsfrist',
      wert: TAG(zahlungsfrist(forderung.neueFrist, nochNichtFaellig)),
    })
    return liste
  }, [forderung, hatZusaetze, nochNichtFaellig])

  /**
   * Was die zugeklappte „Anpassen"-Zeile nennen muss.
   *
   * Ein Bereich, der zu ist, darf nichts verstecken, worauf es ankommt —
   * dasselbe Versprechen wie bei der manuellen Rechnungsnummer im
   * Entwurfseditor. Genannt wird deshalb jeder Wert, der vom glatten
   * Normalfall abweicht, gleich ob der Nutzer ihn gesetzt oder der Server ihn
   * gerechnet hat. So kann der Bereich zubleiben, ohne etwas zu unterschlagen.
   */
  const abweichungen = useMemo(() => {
    const liste: string[] = []

    // Eine andere Stufe als die, die der Server von sich aus vorgeschlagen hat.
    if (anpassung.stage !== undefined && anpassung.stage !== basis.stufe?.position && status.stufe)
      liste.push(`${status.stufe.position}. ${status.stufe.name}`)

    // Der Verzugsbeginn — selbst eingetragen oder vom 30-Tage-Boden
    // verschoben. Der gerechnete Fall ist richtig und muss nicht bestätigt
    // werden, aber der Nutzer soll das Datum sehen: Ab ihm laufen die Zinsen,
    // und bei Stufe 2 und 3 steht es im Brief.
    if (
      anpassung.defaultSince !== undefined ||
      (invoice.due_date !== null && status.verzugsbeginn !== invoice.due_date)
    )
      liste.push(`Verzug seit ${TAG(status.verzugsbeginn)}`)

    // Nur der angefasste Schalter zählt: Dass eine Stufe von sich aus keine
    // Zinsen vorsieht, ist keine Abweichung, sondern ihre Einstellung.
    if (anpassung.interest !== undefined)
      liste.push(anpassung.interest ? 'Zinsen berechnet' : 'ohne Zinsen')

    if (anpassung.baseRate !== undefined) liste.push(`Basiszins ${PROZENT(anpassung.baseRate)} %`)
    else if (status.stale && zinsenAn) liste.push('Basiszins ungeprüft')

    // Früher mahnen als geplant ist erlaubt, soll aber dastehen.
    if (status.stufe !== null && !status.istFaellig)
      liste.push(
        status.faelligAb ? `Stufe erst ab ${TAG(status.faelligAb)} fällig` : 'Stufe noch nicht fällig'
      )

    return liste
  }, [anpassung, basis.stufe, status, invoice.due_date, zinsenAn])

  const handleSpeichern = async () => {
    if (!forderung || !status.stufe) return
    setIstAmSpeichern(true)
    setFehler(null)
    try {
      await legeMahnungAn(invoice.id, anpassung, text)
      toast.success(`${status.stufe.name} als Entwurf gespeichert`)
      onCreated()
      onClose()
      router.refresh()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Der Entwurf konnte nicht angelegt werden.')
    } finally {
      setIstAmSpeichern(false)
    }
  }

  /**
   * Der wahrscheinlichste Ausgang: Es wurde längst bezahlt.
   *
   * Derselbe Weg wie in `components/invoices/status-updater.tsx` — ein Update
   * auf `invoices.status` über den Browser-Client, danach `router.refresh()`.
   * Den Nutzer dafür in eine andere Ansicht zu schicken hiesse, ihn für den
   * häufigsten Fall den längsten Weg gehen zu lassen.
   */
  const handleBereitsBezahlt = async () => {
    setIstAmBezahlen(true)
    const { error } = await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id)
    setIstAmBezahlen(false)

    if (error) {
      setFehler('Der Status konnte nicht geändert werden.')
      return
    }
    toast.success('Rechnung als bezahlt markiert')
    onClose()
    onPaid()
    router.refresh()
  }

  const titel = status.stufe
    ? `${status.stufe.name} · Rechnung ${invoice.invoice_number || 'ohne Nummer'}`
    : `Rechnung ${invoice.invoice_number || 'ohne Nummer'}`

  return (
    <Dialog open={isOpen} onOpenChange={(offen) => !offen && onClose()}>
      {/* Drei Zeilen: Kopf und Fuss stehen, nur die Mitte rollt — „Senden" ist
          damit nie weggescrollt, und der Titel sagt jederzeit, worum es geht.

          Die Höhe hat zwei Grenzen, und die kleinere gewinnt. `88svh` hält den
          Dialog auf kleinen und auf durch Browserleisten verkürzten Schirmen
          im Bild (`svh` statt `vh`: die mobile Adressleiste zählt mit). Die
          feste Grenze von 42 rem ist die eigentliche Neuerung: Ein Dialog, der
          auf einem hohen Monitor von Kante zu Kante läuft, ist kein Dialog
          mehr, sondern eine Seite — er braucht einen sichtbaren Rand, damit
          erkennbar bleibt, dass dahinter etwas liegt, zu dem man zurückkehrt. */}
      <DialogContent className="sm:max-w-xl max-h-[min(42rem,88svh)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{titel}</DialogTitle>
          <DialogDescription>An {empfaenger}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1">
          {/* Die einzige Frage — und sie steht ganz oben, weil ihre Antwort
              die Beträge im Brief darunter verändert. Eine Frage unterhalb
              dessen, was von ihr abhängt, wird erst gelesen, wenn man das
              Ergebnis schon geglaubt hat. Schmal gehalten: eine Zeile statt
              eines Kastens, denn sie erscheint ohnehin nur, wenn Zinsen oder
              Pauschale im Spiel sind. */}
          {kundentypGefragt && (
            <fieldset className="mb-4 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              {/* Sichtbar als Text, für Hilfsmittel als `legend` — sonst
                  spräche der Screenreader die Frage bei jedem Feld doppelt. */}
              <legend className="sr-only">Wer schuldet den Betrag?</legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span aria-hidden="true" className="text-sm text-zinc-600 dark:text-zinc-400">
                  Wer schuldet den Betrag?
                </span>
                {(
                  [
                    { wert: 'business', label: 'Unternehmen' },
                    { wert: 'consumer', label: 'Privatperson' },
                  ] as { wert: DunningCustomerType; label: string }[]
                ).map(({ wert, label }) => (
                  <label key={wert} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="dunning-customer-type"
                      value={wert}
                      checked={anpassung.customerType === wert}
                      className="size-4 accent-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:accent-zinc-100"
                      onChange={() =>
                        setAnpassung((prev) => ({ ...prev, customerType: wert }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Zinssatz und Pauschale hängen davon ab. Ohne Angabe rechnen wir mit dem
                niedrigeren Satz.
              </p>
            </fieldset>
          )}

          {forderung ? (
            <>
              {/* Der Brief zuerst — er ist das, was beim Kunden ankommt, und
                  damit das Einzige, was wirklich geprüft werden muss. Die
                  Zahlen standen vorher darüber und schoben ihn aus dem Bild;
                  jetzt tragen sie ihn von unten. */}
              {/* An wen, steht schon im Kopf des Dialogs — hier genügt, was
                  das Feld ist. */}
              <Label htmlFor="dunning-text" className="text-xs text-zinc-500 dark:text-zinc-400">
                Schreiben
              </Label>
              {/* `rows` ist nur der Stand vor der ersten Messung — gleich hoch
                  wie das kürzeste vorbereitete Schreiben, damit beim Öffnen
                  nichts springt. `resize-none`, weil ein von Hand gezogener
                  Griff beim nächsten Tastendruck wieder zurückschnappen würde;
                  die Höhenmessung ist der bessere Griff. */}
              <Textarea
                id="dunning-text"
                ref={textfeld}
                rows={14}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setTextVomNutzer(true)
                }}
                className="mt-1 max-h-[22rem] min-h-32 resize-none text-sm leading-relaxed"
              />

              {/* Die Zahlen: ein Streifen, kein Block. Was 0 ist, steht nicht
                  da — eine Zeile „Pauschale 0,00 €" erklärt nichts und sieht
                  aus wie ein Fehler. Im Regelfall bleiben genau zwei Angaben,
                  und die passen nebeneinander. */}
              <dl
                className={`mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-md bg-zinc-50 px-3 py-2 transition-opacity dark:bg-zinc-800/60 ${
                  istAmRechnen ? 'opacity-50' : ''
                }`}
                aria-busy={istAmRechnen}
              >
                {kennzahlen.map(({ label, wert, stark }) => (
                  <div key={label}>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
                    {/* „Gesamtforderung" ist die Aussage, die übrigen Posten
                        sind nur ihre Herkunft — deshalb trägt sie allein das
                        Gewicht statt eines Trennstrichs, der beim Umbrechen
                        ohnehin an der falschen Stelle landete. */}
                    <dd className={`text-sm tabular-nums ${stark ? 'font-semibold' : ''}`}>
                      {wert}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Die Klammer zu den Zinsen steht als Fussnote und nicht mehr
                  unter ihrer Beschriftung: Dort machte sie die Spalte so
                  breit, dass der Streifen umbrach. */}
              {forderung.zinsen > 0 && zinsText && (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  Verzugszinsen: {zinsText}
                </p>
              )}
              {nochNichtFaellig && (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  Eine Erinnerung vor Fälligkeit verkürzt die Frist nicht — es bleibt bei
                  dem Datum, das auf der Rechnung steht.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {status.grund || 'Für diese Rechnung lässt sich derzeit keine Forderung beziffern.'}
            </p>
          )}

          {status.hinweise.length > 0 && (
            <ul className="mt-4 max-h-28 space-y-1 overflow-y-auto rounded-md bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {status.hinweise.map((hinweis, index) => (
                <li key={index}>{hinweis}</li>
              ))}
            </ul>
          )}

          {/* Kein eigenes Bauteil: components/ui/ hat weder Collapsible noch
              Accordion, und <details>/<summary> bringt Tastaturbedienung und
              die Zustandsansage ohne neue Abhängigkeit mit — so wie bei der
              manuellen Rechnungsnummer im Entwurfseditor. */}
          <details
            open={anpassenOffen}
            onToggle={(e) => setAnpassenOffen(e.currentTarget.open)}
            className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className={`h-4 w-4 shrink-0 transition-transform ${anpassenOffen ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
              Anpassen
              {/* Abweichende Werte müssen auch zugeklappt dastehen — sonst
                  versteckt der Bereich genau das, was man wissen muss.
                  Aufgeklappt stehen sie zwei Zeilen tiefer an ihren Feldern;
                  sie dann hier zu wiederholen wäre Lärm. */}
              {!anpassenOffen && abweichungen.length > 0 && (
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {abweichungen.join(' · ')}
                </span>
              )}
            </summary>

            <div className="mt-3 space-y-4">
              <div>
                <Label className="text-xs text-zinc-500 dark:text-zinc-400">Stufe</Label>
                {stufenOptionen.length > 1 ? (
                  <Select
                    value={String(anpassung.stage ?? status.stufe?.position ?? '')}
                    onValueChange={(wert) =>
                      setAnpassung((prev) => ({ ...prev, stage: Number(wert) }))
                    }
                  >
                    <SelectTrigger className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stufenOptionen.map((stufe) => (
                        <SelectItem key={stufe.position} value={String(stufe.position)}>
                          {stufe.position}. {stufe.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  // Eine Auswahl mit einem einzigen Eintrag ist keine Auswahl.
                  <p className="mt-1 text-sm">
                    {status.stufe ? `${status.stufe.position}. ${status.stufe.name}` : '—'}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs text-zinc-500 dark:text-zinc-400">Verzug seit</Label>
                <div className="mt-1">
                  <DatePicker
                    value={anpassung.defaultSince ?? status.verzugsbeginn}
                    onChange={(datum) =>
                      setAnpassung((prev) => ({ ...prev, defaultSince: datum ?? undefined }))
                    }
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  Ab diesem Tag laufen die Zinsen. Bei Privatpersonen frühestens 30 Tage nach
                  Rechnungserhalt (§ 286 Abs. 3 BGB).
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="dunning-interest" className="text-sm">
                  Verzugszinsen berechnen
                </Label>
                <Switch
                  id="dunning-interest"
                  checked={zinsenAn}
                  onCheckedChange={(an) => setAnpassung((prev) => ({ ...prev, interest: an }))}
                />
              </div>

              {/* Der Basiszinssatz gehört zum Schalter darüber: Sind die Zinsen
                  aus, ist das Feld wirkungslos. Deaktiviert statt ausgeblendet
                  — Ausblenden liesse beim Umlegen des Schalters alles darunter
                  springen, und wer gerade im Feld steht, verlöre den Fokus ins
                  Nichts. So bleibt stattdessen sichtbar, woran der Satz hängt,
                  und das Umlegen bewegt nur die Beschriftung darunter. */}
              <div>
                <Label htmlFor="dunning-base-rate" className="text-xs text-zinc-500 dark:text-zinc-400">
                  Basiszinssatz (% p. a.)
                </Label>
                <Input
                  id="dunning-base-rate"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  disabled={!zinsenAn}
                  className="mt-1"
                  placeholder={
                    status.zinsDetails?.segments[0]
                      ? PROZENT(status.zinsDetails.segments[0].baseRate)
                      : 'hinterlegter Satz'
                  }
                  value={basiszinsText}
                  onChange={(e) => {
                    const roh = e.target.value
                    setBasiszinsText(roh)
                    const zahl = Number(roh)
                    setAnpassung((prev) => ({
                      ...prev,
                      baseRate: roh === '' || Number.isNaN(zahl) ? undefined : zahl,
                    }))
                  }}
                />
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  {!zinsenAn
                    ? 'Wird erst gebraucht, wenn Verzugszinsen berechnet werden.'
                    : status.stale
                      ? 'Der hinterlegte Basiszinssatz ist nicht geprüft. Bitte bestätigen oder korrigieren Sie ihn.'
                      : 'Leer lassen, um den hinterlegten Satz der Deutschen Bundesbank zu verwenden.'}
                </p>
              </div>
            </div>
          </details>

          {fehler && <p className="mt-4 message-error text-sm">{fehler}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Zurückhaltend und links: der häufigste Ausgang einer Mahnung ist,
              dass bezahlt wurde — aber er ist nicht das, wozu dieser Dialog
              aufgefordert hat.

              Er setzt die Rechnung allerdings auf „bezahlt", und neben dem
              gleich aussehenden „Abbrechen" wurde er dafür zu leicht
              verwechselt. Statt einer Rückfrage — die Änderung lässt sich im
              Status-Umschalter zurücknehmen — bekommt er dasselbe wie das
              „Löschen" im Entwurfseditor: eigene Zone links, eigenes Zeichen.
              Das Häkchen sagt, dass hier etwas festgestellt und nicht
              abgebrochen wird; auf schmalen Bildschirmen, wo die Fusszeile zur
              Spalte wird, trennt ihn zusätzlich eine Linie vom Rest. */}
          <div className="mt-2 border-t border-zinc-200 pt-3 dark:border-zinc-700 sm:mt-0 sm:border-t-0 sm:pt-0">
            <Button
              type="button"
              variant="ghost"
              onClick={handleBereitsBezahlt}
              disabled={istAmBezahlen || istAmSpeichern}
              className="w-full text-zinc-500 hover:text-zinc-900 sm:w-auto dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {istAmBezahlen ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CircleCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Rechnung ist bereits bezahlt
            </Button>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={istAmSpeichern}>
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={handleSpeichern}
              disabled={istAmSpeichern || istAmRechnen || !forderung || !status.mahnbar}
            >
              {istAmSpeichern && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Als Entwurf speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
