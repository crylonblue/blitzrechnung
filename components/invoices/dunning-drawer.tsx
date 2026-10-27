'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as SchubladePrimitive from '@radix-ui/react-dialog'
import { ChevronRight, CircleCheck, LoaderCircle, SendHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
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
import { baueMahnschreiben } from '@/lib/reminder-text'
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
 * Der Prüfbildschirm — eine Schublade, kein Dialog.
 *
 * Diese Anwendung benutzt Schubladen überall dort, wo *gearbeitet* wird:
 * Entwurfseditor, Rechnungsansicht, Kontaktbearbeitung. Ein Mahnschreiben zu
 * lesen, zu prüfen und zu ändern ist genau das. Als Dialog musste sich der
 * Bildschirm künstlich auf `min(42rem, 88svh)` deckeln und das Textfeld auf
 * 22 rem, damit die Zahlen nicht aus dem Bild gedrückt wurden — eine
 * Schublade hat die volle Höhe von Haus aus, und der Brief darf atmen.
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
 * Das ist die Unterscheidung, an der diese Schublade zwei grundverschiedene
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
 * Das vorbereitete Schreiben — in der Sprache der Rechnung.
 *
 * Der Wortlaut kommt aus `baueMahnschreiben` (`lib/reminder-text.ts`), also
 * aus derselben Quelle wie der Standardtext im PDF. Hier stand bisher eine
 * zweite, nur deutsche Fassung; weil das Textfeld immer mitgeschickt wird,
 * trug jede englische Mahnung einen deutschen Brief.
 *
 * Die Stufe bestimmt den Ton, nicht der Nutzer. Wer es anders haben will,
 * schreibt im Textfeld darüber — deshalb ist es ein Textfeld und keine
 * Vorschau. Die Beträge stehen nicht im Text: Sobald es mehr als die
 * Hauptforderung gibt, druckt das PDF sie als eigene Aufstellung.
 */
function baueSchreiben({ invoice, absender, status }: SchreibenInput): string {
  const forderung = status.forderung
  if (!forderung || !status.stufe) return ''

  const language = invoice.language === 'en' ? 'en' : 'de'
  const heute = new Date().toISOString().split('T')[0]
  const nochNichtFaellig = faelligkeitNochVoraus(invoice, status.verzugsbeginn)

  return baueMahnschreiben({
    stagePosition: status.stufe.position,
    rechnungsnummer: invoice.invoice_number || (language === 'en' ? 'without number' : 'ohne Nummer'),
    // Derselbe Ersatz wie beim Ablegen des Schreibens (`legeSchreibenAb`).
    rechnungsdatum: invoice.invoice_date ?? heute,
    // `baueMahnschreiben` erkennt die Vorab-Erinnerung an „Fälligkeit nach
    // Schreibdatum". Diese Schublade zieht die Grenze strenger (siehe
    // `faelligkeitNochVoraus`: hat der Verzug schon begonnen, ist es keine
    // Vorab-Erinnerung mehr). Deshalb geht eine künftige Fälligkeit nur
    // hinein, wenn auch die Schublade sie als bevorstehend wertet — sonst
    // nennt der Text den Verzugsbeginn.
    rechnungsFaelligkeit:
      nochNichtFaellig ?? (invoice.due_date && invoice.due_date <= heute ? invoice.due_date : null),
    verzugSeit: status.verzugsbeginn,
    reminderDate: heute,
    zahlbarBis: zahlungsfrist(forderung.neueFrist, nochNichtFaellig),
    offenerBetrag: forderung.offenerBetrag,
    summe: forderung.summe,
    hatZusaetze: forderung.zinsen > 0 || forderung.gebuehr > 0 || forderung.pauschale > 0,
    absender,
    language,
  })
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

/**
 * Die Ebene dieser Schublade — und warum sie in jede Richtung stimmt.
 *
 * Die Staffelung der Anwendung steht im Kopf von `components/ui/dialog.tsx`:
 *
 *   50  Schublade (`sheet.tsx`): Abdunklung und Inhalt.
 *   60  Dialog (`dialog.tsx`): Abdunklung und Inhalt.
 *   70  Popover und Auswahlmenü (`popover.tsx`, `select.tsx`).
 *
 * Diese Schublade geht **aus der Rechnungsschublade heraus** auf und liegt
 * deshalb auf 55:
 *
 *  * **über 50**, sonst entschiede bei Gleichstand die Reihenfolge im DOM —
 *    und die fiel schon einmal zugunsten der Rechnungsschublade aus: Ihre
 *    Knöpfe standen neben der Abdunklung in voller Helligkeit und sahen aus,
 *    als gehörten sie zum Mahnschreiben. Die Abdunklung muss mit hoch, sonst
 *    läge die Schublade zwar oben, die Rechnung darunter aber unverdunkelt.
 *  * **unter 60**, weil aus dieser Schublade heraus noch ein Dialog aufgehen
 *    kann (heute keiner — eine Rückfrage vor dem Versand wäre der nächste
 *    Kandidat), und ein Dialog ist modal: Er muss über dem liegen, was ihn
 *    geöffnet hat.
 *  * **unter 70**, weil in dieser Schublade das Datumsfeld („Verzug seit")
 *    und die Stufenauswahl benutzt werden. Ein Menü, das hinter der Fläche
 *    verschwindet, aus der es kommt, ist unbedienbar.
 *
 * Warum dafür nicht `components/ui/sheet.tsx` benutzt wird: `SheetContent`
 * reicht zwar `className` an seinen Inhalt durch, hängt die Abdunklung aber
 * selbst und ohne Durchgriff ein (`<SheetOverlay />`, fest auf `z-50`).
 * Von aussen ist die Abdunklung damit nicht erreichbar — und ohne sie wäre
 * das Höherlegen halb. Die Vorgabe in `sheet.tsx` zu verschieben, hiesse
 * sechs andere Schubladen mitzuverschieben (`draft-drawer`, `product-drawer`,
 * `issuer-drawer`, `contact-drawer`, `contact-edit-drawer`, `invoice-drawer`),
 * die alle auf 50 richtig liegen. Also wird hier dasselbe Grundelement
 * benutzt, auf dem `sheet.tsx` und `dialog.tsx` ohnehin beide aufsitzen
 * (`@radix-ui/react-dialog`) — keine neue Abhängigkeit, nur eine Fläche mit
 * eigener Ebene. Aussehen und Bewegung sind aus `sheet.tsx` übernommen, damit
 * sie sich nicht wie ein Fremdkörper öffnet.
 *
 * Dass es dasselbe Radix-Modul ist, trägt auch das Verschachteln: Escape und
 * der Klick auf die Abdunklung treffen die oberste Fläche des gemeinsamen
 * Stapels, also diese — die Rechnungsschublade bleibt offen, und der Fokus
 * kehrt beim Schliessen auf den Knopf zurück, der sie geöffnet hat.
 */

interface DunningDrawerProps {
  invoice: Invoice
  /** Name des Empfängers, so wie ihn die Schublade schon aufgelöst hat. */
  empfaenger: string
  /** Name der eigenen Firma — die Unterschrift unter dem Schreiben. */
  absender: string
  /** Der ungefilterte Serverstand, bereits von der Schublade geholt. */
  basis: DunningStatus
  /**
   * Die Stufe, die der Nutzer in „Dokument hinzufügen" gewählt hat. `null`
   * heisst „die, die ohnehin dran ist" — dann entscheidet der Server.
   */
  startStufe?: number | null
  isOpen: boolean
  onClose: () => void
  /** Mahnung erstellt (und ggf. versendet) — die Schublade lädt alles neu. */
  onCreated: () => void
  /** Rechnung ist bezahlt — die Schublade schliesst sich. */
  onPaid: () => void
  /**
   * Der Knopf, der diese Schublade geöffnet hat — dorthin kehrt der Fokus
   * beim Schliessen zurück. Warum das von Hand geschehen muss, steht am
   * `onCloseAutoFocus` weiter unten.
   */
  oeffnerRef?: React.RefObject<HTMLButtonElement | null>
}

export default function DunningDrawer({
  invoice,
  empfaenger,
  absender,
  basis,
  startStufe = null,
  isOpen,
  onClose,
  onCreated,
  onPaid,
  oeffnerRef,
}: DunningDrawerProps) {
  const router = useRouter()
  const supabase = createClient()

  const [anpassung, setAnpassung] = useState<DunningAnpassung>({})
  const [status, setStatus] = useState<DunningStatus>(basis)
  const [istAmRechnen, setIstAmRechnen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  /** Welcher der beiden Knöpfe gerade läuft — oder keiner. */
  const [laeuft, setLaeuft] = useState<'senden' | 'erstellen' | null>(null)
  const [istAmBezahlen, setIstAmBezahlen] = useState(false)

  const [text, setText] = useState('')
  // Sobald der Nutzer den Text angefasst hat, wird er nicht mehr überschrieben:
  // eine Anpassung an den Zahlen darf keine getippte Zeile wegwerfen.
  const [textVomNutzer, setTextVomNutzer] = useState(false)

  /**
   * Das Begleitschreiben der E-Mail — der zweite Text.
   *
   * Er folgt der Vorbereitung des Servers, solange ihn niemand anfasst; dann
   * gilt dieselbe Regel wie beim Mahnschreiben. Gespeichert wird er nirgends:
   * Er gilt für diesen einen Versand.
   */
  const [mailEmpfaenger, setMailEmpfaenger] = useState('')
  const [mailBetreff, setMailBetreff] = useState('')
  const [mailText, setMailText] = useState('')
  const [mailVomNutzer, setMailVomNutzer] = useState(false)
  const [mailOffen, setMailOffen] = useState(false)

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

  // Beim Öffnen auf den Stand zurück, den die Rechnungsschublade geholt hat. Eine
  // Fläche, die die Einstellungen des letzten Males noch trägt, mahnt beim zweiten Mal
  // anders als beim ersten, ohne dass jemand etwas geändert hätte.
  useEffect(() => {
    if (!isOpen) return
    // Die gewählte Stufe ist die einzige Einstellung, die das Öffnen überlebt
    // — sie ist die Antwort auf die Frage „welches Dokument?" und stand damit
    // schon vor der Schublade fest.
    setAnpassung(startStufe === null ? {} : { stage: startStufe })
    setStatus(basis)
    setFehler(null)
    setTextVomNutzer(false)
    setMailVomNutzer(false)
    setMailOffen(false)
    setBasiszinsText('')
    setKundentypGefragt(false)
    setAnpassenOffen(startetOffen(basis))
  }, [isOpen, basis, startStufe])

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

  // Dasselbe für die Begleit-E-Mail — nur kommt sie fertig vom Server, weil
  // dort auch die Vorlage für den Versand ohne Bildschirm liegt.
  useEffect(() => {
    if (!isOpen || mailVomNutzer || !status.mail) return
    setMailEmpfaenger(status.mail.empfaenger ?? '')
    setMailBetreff(status.mail.betreff)
    setMailText(status.mail.text)
  }, [isOpen, mailVomNutzer, status.mail])

  const textfeld = useRef<HTMLTextAreaElement | null>(null)

  /**
   * Das Textfeld misst sich an seinem Inhalt.
   *
   * Die vorbereiteten Schreiben sind in dieser Breite je nach Stufe rund 14
   * bis 24 Zeilen lang: am kürzesten die Zahlungserinnerung ohne Aufstellung,
   * am längsten die letzte Mahnung mit allen Posten und einem langen
   * Firmennamen. Bei einer festen Zeilenzahl endete der Text deshalb ohne
   * jedes Zeichen dafür, dass es weitergeht; eine feste Höhe für den längsten
   * Fall stünde im Regelfall halb leer im Weg. Also wächst das Feld mit.
   *
   * **Ohne obere Grenze**, und das ist der Gewinn der Schublade. Im Dialog
   * war das Feld auf 22 rem gedeckelt: Kopf, Fusszeile und Innenabstand
   * nahmen von den 42 rem Dialoghöhe rund 12 rem, ein höheres Feld hätte die
   * Zahlen darunter aus dem Bild gedrängt. Hier rollt stattdessen die Mitte
   * der Schublade (siehe den Aufbau unten), und der Brief steht am Stück da —
   * ein Feld, das in sich rollt, während daneben die Fläche auch rollt, ist
   * beim Korrekturlesen das Unangenehmste von beidem.
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
   * Die Hauptsache dieser Schublade ist der Brief — er ist das, was beim Kunden
   * ankommt und was geprüft werden will. Die Aufstellung stand davor als
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

  /**
   * Erstellen — und auf Wunsch gleich verschicken.
   *
   * Beides derselbe Aufruf, weil es für den Nutzer ein Vorgang ist. Der
   * Unterschied in der Antwort ist der wichtige: Die Mahnung entsteht in
   * beiden Fällen, nur die E-Mail kann ausbleiben. Dann bleibt die Schublade
   * **nicht** offen — das Dokument ist da, und der Satz dazu steht als
   * Hinweis in der Belegübersicht, wo auch der Knopf zum erneuten Senden
   * sitzt.
   */
  const handleErstellen = async (senden: boolean) => {
    if (!forderung || !status.stufe) return
    if (senden && !mailEmpfaenger.trim()) {
      setMailOffen(true)
      setFehler('Zum Versenden fehlt die E-Mail-Adresse des Empfängers.')
      return
    }

    setLaeuft(senden ? 'senden' : 'erstellen')
    setFehler(null)
    try {
      const ergebnis = await legeMahnungAn(invoice.id, anpassung, {
        text,
        senden,
        mail: { empfaenger: mailEmpfaenger.trim(), betreff: mailBetreff, text: mailText },
      })

      if (ergebnis.versendet) {
        toast.success(`${status.stufe.name} versendet`, {
          description: `An ${ergebnis.empfaengerEmail}. Das Mahnschreiben liegt als PDF bei den Dokumenten.`,
        })
      } else if (ergebnis.versandFehler) {
        // Zwei Nachrichten in einer: Das Dokument ist da, die E-Mail nicht.
        // Eine reine Fehlermeldung verschwiege das Erste und liesse den
        // Nutzer ein zweites Mal erstellen.
        toast.warning(`${status.stufe.name} erstellt, aber nicht versendet`, {
          description: `${ergebnis.versandFehler} Sie können sie unter „Dokumente" erneut senden.`,
        })
      } else {
        toast.success(`${status.stufe.name} erstellt`, {
          description: 'Das Mahnschreiben liegt als PDF bei den Dokumenten.',
        })
      }

      onCreated()
      onClose()
      router.refresh()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Mahnung konnte nicht erstellt werden.')
    } finally {
      setLaeuft(null)
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
    <SchubladePrimitive.Root open={isOpen} onOpenChange={(offen) => !offen && onClose()}>
      <SchubladePrimitive.Portal>
        {/* Die Abdunklung muss mit auf 55 — sonst läge die Schublade zwar über
            der Rechnung, die Rechnung darunter aber unverdunkelt und sähe aus,
            als könnte man sie noch bedienen. Begründung der Ebene: oben. */}
        <SchubladePrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-55 bg-black/50" />

        {/* Breite: 42 rem — die Breite, die diese Anwendung ihren
            Arbeitsflächen gibt (Entwurf, Produkt, Absender, Kontakt). Die
            Rechnungsschublade darunter ist mit 28 rem eine Leseansicht; hier
            wird geschrieben, und der Brief ist die Hauptsache. Dass die obere
            Fläche breiter ist, ist zugleich das Zeichen, dass es zwei sind:
            Sie tritt links über die Kante der Rechnung hinaus, statt sie nur
            Pixel für Pixel zu ersetzen.

            Drei Zeilen wie im Entwurfseditor (`components/drafts/draft-editor.tsx`):
            fest sitzender Kopf, rollende Mitte, fest sitzende Aktionsleiste.
            „Mahnung senden" ist damit nie weggescrollt, und der Titel
            sagt jederzeit, worum es geht. `min-h-0` an der Mitte, weil ein
            Flex-Kind sonst nicht unter seine Inhaltshöhe schrumpft und statt
            der Mitte die ganze Schublade rollte. */}
        <SchubladePrimitive.Content
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-55 flex h-full w-full max-w-[42rem] flex-col border-l shadow-lg transition ease-out data-[state=closed]:duration-150 data-[state=open]:duration-200"
          /**
           * Der Fokus zurück auf den Knopf, der die Schublade geöffnet hat.
           *
           * Das muss hier von Hand stehen: Radix' modale Fläche gibt den Fokus
           * nicht an das Element zurück, das vor dem Öffnen den Fokus hatte,
           * sondern an ihren eigenen `Trigger` — und einen solchen gibt es
           * hier nicht, weil der Mahnknopf in `dunning-section.tsx` den Zustand
           * selbst umlegt. Ohne diese Zeile landete der Fokus nach dem
           * Schliessen auf `<body>`: Wer mit der Tastatur arbeitet, stünde
           * wieder am Anfang der Seite statt in der Rechnungsschublade, aus
           * der er gekommen ist. (Das war schon am Dialog so und ist hier
           * mitrepariert.)
           *
           * `document.contains` fängt den Fall ab, in dem der Knopf das
           * Schliessen nicht überlebt — „Rechnung ist bereits bezahlt" nimmt
           * die ganze Rechnungsschublade mit.
           */
          onCloseAutoFocus={(e) => {
            const knopf = oeffnerRef?.current
            if (!knopf || !document.contains(knopf)) return
            e.preventDefault()
            knopf.focus()
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
            <div className="min-w-0">
              <SchubladePrimitive.Title className="text-lg font-semibold leading-tight">
                {titel}
              </SchubladePrimitive.Title>
              <SchubladePrimitive.Description className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                An {empfaenger}
              </SchubladePrimitive.Description>
            </div>
            {/* Im Kopf statt freischwebend in der Ecke: Der Titel kann zwei
                Zeilen lang werden (Stufenname plus Rechnungsnummer), und ein
                absolut gesetzter Knopf läge dann darauf. */}
            <SchubladePrimitive.Close asChild>
              <Button variant="outline" size="icon" className="shrink-0">
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Schliessen</span>
              </Button>
            </SchubladePrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
                {/* Die Beschriftung sagt, **wohin** der Text geht, nicht nur,
                    dass es einer ist. „Schreiben" stand hier vorher allein und
                    liess offen, ob es der Brief oder die E-Mail ist — und seit
                    es beide gibt, ist das die entscheidende Auskunft. Der
                    zweite Text steht weiter unten unter „E-Mail-Text", mit
                    derselben Art Satz darunter. */}
                <Label htmlFor="dunning-text" className="text-xs text-zinc-500 dark:text-zinc-400">
                  Mahnschreiben
                </Label>
                <p className="mb-1 text-xs text-zinc-400 dark:text-zinc-500">
                  Dieser Text steht im PDF, das Ihr Kunde als Mahnschreiben bekommt.
                </p>
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
                  className="mt-1 min-h-32 resize-none text-sm leading-relaxed"
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

                {/* Der zweite Text, hinter einer Aufklappstelle.
                    Er ist vorbelegt und in den allermeisten Fällen richtig:
                    Wer nichts ändern will, soll ihn nicht lesen müssen. Dass
                    es ihn gibt und was er ist, sagt die zugeklappte Zeile
                    trotzdem — sie nennt die Empfängeradresse, denn die ist
                    das Einzige daran, was falsch sein kann, ohne dass man es
                    merkt. Dasselbe Bauteil wie „Anpassen" darunter. */}
                <details
                  open={mailOffen}
                  onToggle={(e) => setMailOffen(e.currentTarget.open)}
                  className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 transition-transform ${mailOffen ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    E-Mail-Text
                    {!mailOffen && (
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {mailEmpfaenger.trim() || 'keine Adresse hinterlegt'}
                      </span>
                    )}
                  </summary>

                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      Dieser Text steht in der E-Mail. Das Mahnschreiben von oben hängt als
                      PDF an.
                    </p>

                    <div>
                      <Label
                        htmlFor="dunning-mail-to"
                        className="text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        An
                      </Label>
                      <Input
                        id="dunning-mail-to"
                        type="email"
                        className="mt-1"
                        placeholder="rechnung@kunde.de"
                        value={mailEmpfaenger}
                        onChange={(e) => {
                          setMailEmpfaenger(e.target.value)
                          setMailVomNutzer(true)
                        }}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="dunning-mail-subject"
                        className="text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        Betreff
                      </Label>
                      <Input
                        id="dunning-mail-subject"
                        className="mt-1"
                        value={mailBetreff}
                        onChange={(e) => {
                          setMailBetreff(e.target.value)
                          setMailVomNutzer(true)
                        }}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="dunning-mail-body"
                        className="text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        Nachricht
                      </Label>
                      <Textarea
                        id="dunning-mail-body"
                        rows={7}
                        className="mt-1 text-sm leading-relaxed"
                        value={mailText}
                        onChange={(e) => {
                          setMailText(e.target.value)
                          setMailVomNutzer(true)
                        }}
                      />
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {status.grund || 'Für diese Rechnung lässt sich derzeit keine Forderung beziffern.'}
              </p>
            )}

            {/* Die Hinweise des Servers, in seiner Reihenfolge — sie ist eine
                Rangfolge, der wichtigste steht oben.

                Ohne eigenen Rollbalken: Im Dialog rollte die Liste ab 7 rem in
                sich (`max-h-28`), weil der Platz knapp war; ein Kasten, der in
                einem rollenden Bereich noch einmal für sich rollt, versteckt
                seine letzten Zeilen zuverlässig. Die Schublade hat die Höhe,
                also stehen alle Hinweise da. */}
            {status.hinweise.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-md bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
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

          {/* Die Aktionsleiste sitzt fest am unteren Rand — `shrink-0` reicht,
              weil die Schublade selbst volle Höhe hat und nicht rollt (im
              Entwurfseditor steht zusätzlich `sticky`, weil derselbe Baustein
              dort auch auf einer eigenen Seite ohne feste Höhe lebt). */}
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Zurückhaltend und links: der häufigste Ausgang einer Mahnung ist,
                dass bezahlt wurde — aber er ist nicht das, wozu diese Schublade
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
                disabled={istAmBezahlen || laeuft !== null}
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

            {/* Zwei Wege aus dieser Schublade, und die Betonung sagt, welcher
                der gewöhnliche ist.

                **„Mahnung senden"** erzeugt das Schreiben und verschickt es in
                einem Zug. Das ist, was jemand will, der auf „mahnen" geklickt
                hat — ein Zwischenzustand, den man erst noch bestätigen muss,
                ist kein Ziel, sondern eine Verzögerung.
                **„Nur erstellen"** erzeugt dasselbe PDF ohne E-Mail: für den
                Postweg, für die Ablage, für den Fall, dass man es vorher noch
                jemandem zeigen will. Es ist die leisere Aktion, weil es
                seltener gebraucht wird — nicht, weil es weniger wert wäre.

                Gelöscht werden kann beides danach, solange keine E-Mail
                hinausging; das steht in der Belegübersicht. */}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={laeuft !== null}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleErstellen(false)}
                disabled={laeuft !== null || istAmRechnen || !forderung || !status.mahnbar}
                title="Erzeugt das Mahnschreiben als PDF, ohne eine E-Mail zu verschicken"
              >
                {laeuft === 'erstellen' && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                Nur erstellen
              </Button>
              <Button
                type="button"
                onClick={() => handleErstellen(true)}
                disabled={laeuft !== null || istAmRechnen || !forderung || !status.mahnbar}
              >
                {laeuft === 'senden' ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {status.stufe?.position === 1 ? 'Erinnerung senden' : 'Mahnung senden'}
              </Button>
            </div>
          </div>
        </SchubladePrimitive.Content>
      </SchubladePrimitive.Portal>
    </SchubladePrimitive.Root>
  )
}
