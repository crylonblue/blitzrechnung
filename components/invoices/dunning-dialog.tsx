'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, LoaderCircle } from 'lucide-react'
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
 * Alles Verstellbare liegt hinter „Anpassen" — eingeklappt, solange nichts
 * vom Standard abweicht. Das Muster (natives `<details>/<summary>`) stammt
 * aus `components/drafts/draft-editor.tsx`; dort steckt die manuelle
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

  const einstieg =
    position === 1
      ? `unsere Rechnung ${nummer}${vom} über ${EUR(forderung.offenerBetrag)} ist seit dem ${TAG(status.verzugsbeginn)} fällig und bei uns noch nicht eingegangen. Vermutlich ist sie in Ihrem Haus untergegangen.`
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
  } bis zum ${TAG(forderung.neueFrist)} auf das unten genannte Konto zu überweisen.`

  const folge =
    position >= 3
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

  /**
   * Weicht die Lage vom glatten Normalfall ab, startet „Anpassen" offen.
   *
   * Drei Abweichungen zählen, und alle drei haben denselben Grund: Der Nutzer
   * soll nicht bestätigen, was er nicht gesehen hat.
   *
   *  * `stale` — der Basiszinssatz ist fortgeschrieben, nicht geprüft. Genau
   *    dafür gibt es im Bereich das Feld, um ihn zu setzen.
   *  * Verzugsbeginn ≠ Fälligkeit der Rechnung — meist der 30-Tage-Boden aus
   *    § 286 Abs. 3 BGB bei Verbrauchern. Die Zinsen laufen dann später los,
   *    als das Fälligkeitsdatum der Rechnung vermuten lässt.
   *  * Die Stufe ist noch nicht fällig — dann mahnt man früher als vorgesehen,
   *    und das ist eine Entscheidung, keine Routine.
   */
  const startetOffen = useCallback(
    (stand: DunningStatus) =>
      stand.stale ||
      (invoice.due_date !== null && stand.verzugsbeginn !== invoice.due_date) ||
      (stand.stufe !== null && !stand.istFaellig),
    [invoice.due_date]
  )

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
  }, [isOpen, basis, startetOffen])

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
      {/* Drei Zeilen: Kopf und Fuss stehen, nur die Mitte rollt. Lange
          Hinweistexte können den Dialog damit nicht aus dem Bild schieben. */}
      <DialogContent className="sm:max-w-xl max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{titel}</DialogTitle>
          <DialogDescription>An {empfaenger}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-1">
          {forderung ? (
            <>
              {/* Die Aufstellung. Was 0 ist, steht nicht da — eine Zeile
                  „Pauschale 0,00 €" erklärt nichts und sieht aus wie ein Fehler. */}
              <dl
                className={`space-y-1.5 text-sm transition-opacity ${istAmRechnen ? 'opacity-50' : ''}`}
                aria-busy={istAmRechnen}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-zinc-600 dark:text-zinc-400">Offener Betrag</dt>
                  <dd className="tabular-nums">{EUR(forderung.offenerBetrag)}</dd>
                </div>

                {forderung.zinsen > 0 && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-600 dark:text-zinc-400">
                      Verzugszinsen
                      {zinsText && (
                        <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                          {zinsText}
                        </span>
                      )}
                    </dt>
                    <dd className="tabular-nums">{EUR(forderung.zinsen)}</dd>
                  </div>
                )}

                {forderung.gebuehr > 0 && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-600 dark:text-zinc-400">Mahnkosten</dt>
                    <dd className="tabular-nums">{EUR(forderung.gebuehr)}</dd>
                  </div>
                )}

                {forderung.pauschale > 0 && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-600 dark:text-zinc-400">Pauschale § 288 Abs. 5</dt>
                    <dd className="tabular-nums">{EUR(forderung.pauschale)}</dd>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-4 border-t border-zinc-200 pt-1.5 font-semibold dark:border-zinc-700">
                  <dt>Gesamtforderung</dt>
                  <dd className="tabular-nums">{EUR(forderung.summe)}</dd>
                </div>
              </dl>

              <p className="mt-4 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">Neue Zahlungsfrist: </span>
                <span className="font-medium">{TAG(forderung.neueFrist)}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {status.grund || 'Für diese Rechnung lässt sich derzeit keine Forderung beziffern.'}
            </p>
          )}

          {/* Die einzige Frage, und nur wenn sie den Betrag ändert. */}
          {kundentypGefragt && (
            <fieldset className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
              <legend className="px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Wer schuldet den Betrag?
              </legend>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                Zinssatz und Pauschale hängen davon ab. Ohne Angabe rechnen wir mit dem
                niedrigeren Satz.
              </p>
              <div className="flex flex-wrap gap-4">
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
            </fieldset>
          )}

          {status.hinweise.length > 0 && (
            <ul className="mt-4 max-h-28 space-y-1 overflow-y-auto rounded-md bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {status.hinweise.map((hinweis, index) => (
                <li key={index}>{hinweis}</li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <Label htmlFor="dunning-text" className="sr-only">
              Schreiben
            </Label>
            <Textarea
              id="dunning-text"
              rows={10}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setTextVomNutzer(true)
              }}
              className="text-sm leading-relaxed"
            />
          </div>

          {/* Kein eigenes Bauteil: components/ui/ hat weder Collapsible noch
              Accordion, und <details>/<summary> bringt Tastaturbedienung und
              die Zustandsansage ohne neue Abhängigkeit mit — so wie bei der
              manuellen Rechnungsnummer im Entwurfseditor. */}
          <details
            open={anpassenOffen}
            onToggle={(e) => setAnpassenOffen(e.currentTarget.open)}
            className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className={`h-4 w-4 shrink-0 transition-transform ${anpassenOffen ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
              Anpassen
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

              <div>
                <Label htmlFor="dunning-base-rate" className="text-xs text-zinc-500 dark:text-zinc-400">
                  Basiszinssatz (% p. a.)
                </Label>
                <Input
                  id="dunning-base-rate"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
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
                  {status.stale
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
              aufgefordert hat. */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleBereitsBezahlt}
            disabled={istAmBezahlen || istAmSpeichern}
            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {istAmBezahlen && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            Rechnung ist bereits bezahlt
          </Button>

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
