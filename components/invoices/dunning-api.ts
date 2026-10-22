import type { InterestResult } from '@/lib/dunning-interest'

/**
 * Der Vertrag zur Mahn-API, aus Sicht der Oberfläche.
 *
 * Die Typen stehen hier und nicht in `lib/`, weil sie die *Antwortform* der
 * Route beschreiben und nicht die Fachlogik: `lib/dunning-claim.ts` rechnet,
 * die Route setzt daraus eine Antwort zusammen, und dieses Modul liest sie.
 * Einzige Ausnahme ist `InterestResult` — die Zinsabschnitte gehen
 * unverändert durch, und sie hier noch einmal abzuschreiben hiesse, zwei
 * Fassungen derselben Wahrheit zu pflegen.
 */

export type DunningCustomerType = 'business' | 'consumer'

export interface DunningStufe {
  position: number
  name: string
}

export interface DunningForderung {
  /** Hauptforderung (brutto). */
  offenerBetrag: number
  zinsen: number
  /** Mahngebühr der Stufe — tatsächliche Kosten, meist 0. */
  gebuehr: number
  /** 40 € nach § 288 Abs. 5 BGB, oder 0. */
  pauschale: number
  summe: number
  /** Die Frist, die dieses Schreiben einräumt. */
  neueFrist: string
}

export interface DunningVerlaufEintrag {
  id: string
  stage_position: number
  stage_name: string
  reminder_date: string
  status: string
  due_date: string
  total_amount: number
  /** Gesetzt heisst: durch eine neuere Fassung abgelöst, zählt nicht mehr. */
  superseded_by: string | null
  /**
   * Das Mahnschreiben als Datei. Die Dokumentenliste bietet den
   * Herunterladen-Knopf genau dann an, wenn hier etwas steht. `null` tragen
   * nur noch Mahnungen von vor der Erzeugung — neue entstehen nicht ohne.
   */
  pdf_url: string | null
  /** Wann das Schreiben hinausging; `null`, solange es das nicht tat. */
  sent_at: string | null
  /** Die hinterlegte Empfängeradresse. */
  recipient_email: string | null
}

/**
 * Die vorbereitete **Begleit-E-Mail** — nicht das Mahnschreiben.
 *
 * Der Server baut sie aus der Mahnung, die entstünde, und verschickt genau
 * diesen Text, wenn der Nutzer ihn nicht anfasst. Deshalb steht er in der
 * Schublade schon da, bevor irgendetwas angelegt ist.
 */
export interface DunningMail {
  /** Vorbelegte Empfängeradresse; kann fehlen. */
  empfaenger: string | null
  betreff: string
  text: string
}

/**
 * Eine eingerichtete Mahnstufe — ein Sprosse der Leiter dieser Firma.
 *
 * Die Rechenfelder tragen die Stufen, die **noch nicht dran sind**. Für sie
 * rechnet der Server keine Forderung (es gibt noch keinen Stichtag), aber die
 * Achse sagt trotzdem, wann sie kommen und was sie zusätzlich fordern werden.
 * Diese Auskunft steht hier, weil sie aus der Einstellung folgt und nicht aus
 * einer Rechnung.
 */
export interface DunningStufenOption {
  position: number
  name: string
  /** Zu dieser Stufe besteht bereits eine gültige Mahnung — nicht noch einmal. */
  bereitsErstellt: boolean
  /** Tage nach der Vorstufe; bei der ersten Stufe nach Fälligkeit der Rechnung. */
  tageNachVorstufe: number
  /** Neue Zahlungsfrist, die diese Stufe einräumt. */
  fristTage: number
  berechnetZinsen: boolean
  berechnetPauschale: boolean
  /** Mahngebühr der Stufe — tatsächliche Kosten, meist 0. */
  gebuehr: number
}

export interface DunningStatus {
  mahnbar: boolean
  grund?: string
  stufe: DunningStufe | null
  alleStufenDurchlaufen: boolean
  faelligAb: string | null
  istFaellig: boolean
  verzugsbeginn: string
  forderung: DunningForderung | null
  zinsDetails: InterestResult | null
  /** `null` heisst unbekannt — nicht „Unternehmen". */
  customerType: DunningCustomerType | null
  /** Der Basiszinssatz ist ungeprüft; der Nutzer muss hinsehen. */
  stale: boolean
  hinweise: string[]
  /** `null`, wenn es nichts zu mahnen gibt. */
  mail: DunningMail | null
  /** Alle eingerichteten Stufen — die Auswahl unter „Dokument hinzufügen". */
  stufen: DunningStufenOption[]
  verlauf: DunningVerlaufEintrag[]
}

/**
 * Was „Anpassen" verstellen kann.
 *
 * Jedes Feld ist optional und `undefined` heisst **Serverstandard**. Deshalb
 * wird nur geschickt, was der Nutzer tatsächlich angefasst hat: Ein
 * mitgeschicktes `interest=on`, das bloss den ohnehin geltenden Zustand
 * wiederholt, wäre später nicht mehr von einer bewussten Entscheidung zu
 * unterscheiden — und genau diese Unterscheidung bestimmt, ob der
 * Anpassen-Bereich aufgeklappt startet.
 */
export interface DunningAnpassung {
  stage?: number
  defaultSince?: string
  interest?: boolean
  baseRate?: number
  customerType?: DunningCustomerType
}

/** Leer heisst: nichts abweichend eingestellt, der Serverstandard gilt. */
export function istUnveraendert(anpassung: DunningAnpassung): boolean {
  return Object.values(anpassung).every((wert) => wert === undefined)
}

function zuQuery(anpassung: DunningAnpassung): string {
  const params = new URLSearchParams()
  if (anpassung.stage !== undefined) params.set('stage', String(anpassung.stage))
  if (anpassung.defaultSince !== undefined) params.set('defaultSince', anpassung.defaultSince)
  if (anpassung.interest !== undefined) params.set('interest', anpassung.interest ? 'on' : 'off')
  if (anpassung.baseRate !== undefined) params.set('baseRate', String(anpassung.baseRate))
  if (anpassung.customerType !== undefined) params.set('customerType', anpassung.customerType)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Fehlertext aus einer Antwort ziehen.
 *
 * Die Routen dieses Projekts antworten mit `{ error, details? }`; steht dort
 * nichts Lesbares, bleibt der Statuscode als letzte Auskunft. Auf keinen Fall
 * eine leere Zeichenkette — eine Fehlermeldung ohne Text ist schlimmer als
 * gar keine.
 */
async function fehlertext(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data?.details || data?.error || fallback
  } catch {
    return fallback
  }
}

/**
 * Den Mahnstatus einer Rechnung holen.
 *
 * Wirft nur bei echten Fehlern. Dass die Route (noch) nicht existiert, ist
 * für den Aufrufer ein Fehler wie jeder andere — die Oberfläche zeigt dann
 * einfach nichts, statt eine halbe Mahnfunktion anzubieten.
 */
export async function ladeMahnstatus(
  invoiceId: string,
  anpassung: DunningAnpassung = {},
  signal?: AbortSignal
): Promise<DunningStatus> {
  const response = await fetch(`/api/invoices/${invoiceId}/dunning${zuQuery(anpassung)}`, { signal })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Der Mahnstatus konnte nicht geladen werden.'))
  }
  return (await response.json()) as DunningStatus
}

/**
 * Die Mahnung anlegen — samt Mahnschreiben.
 *
 * Es wird genau das geschickt, was der Nutzer gesehen hat — dieselben Felder
 * wie bei der Abfrage. Der Server rechnet damit erneut und kommt deshalb auf
 * dieselbe Forderung; stimmte das nicht, stünde in der Mahnung ein anderer
 * Betrag als im Prüfbildschirm, und der Prüfbildschirm wäre wertlos.
 *
 * Zurück kommt die fertige Mahnung mit gefülltem `pdf_url`. Scheitert die
 * Erzeugung des Schreibens, entsteht gar keine Mahnung und der Aufrufer
 * bekommt den Grund als Fehler — es bleibt nichts Halbes zurück.
 */
export interface MahnungAnlegenParams {
  /**
   * Der Brief, der **im PDF** steht. Fehlt er, gilt der Text der Stufe — die
   * Route unterscheidet `undefined` („nicht angegeben") von `''` („kein
   * Text"). Die Achse lässt ihn weg: Sie sendet genau das, was der Server
   * ohnehin vorbereitet hat.
   */
  text?: string
  /** Gleich verschicken? Sonst entsteht nur das Dokument. */
  senden: boolean
  /** Betreff und Text der **E-Mail**; nur beim Senden von Belang. */
  mail?: { empfaenger: string | null; betreff: string; text: string }
}

/**
 * Was dabei herauskam.
 *
 * Erstellen und Senden sind ein Zug, aber nicht ein Schicksal: `mahnung` ist
 * immer da, `versendet` sagt, ob die E-Mail hinausging, und `versandFehler`
 * nennt den Grund, wenn nicht. Das Dokument bleibt in jedem Fall bestehen.
 */
export interface MahnungAnlegenErgebnis {
  mahnung: DunningVerlaufEintrag
  versendet: boolean
  empfaengerEmail?: string
  versandFehler?: string
}

export async function legeMahnungAn(
  invoiceId: string,
  anpassung: DunningAnpassung,
  params: MahnungAnlegenParams
): Promise<MahnungAnlegenErgebnis> {
  const response = await fetch(`/api/invoices/${invoiceId}/dunning`, {
    method: 'POST',
    // Der Versand aus der Achse kann im `pagehide` ausgelöst werden — beim
    // Schliessen des Tabs also. Ohne `keepalive` bricht der Browser die
    // Anfrage mit dem Dokument ab, und die Mahnung entstünde nie, obwohl der
    // Nutzer „senden" gedrückt hat. Der Rumpf bleibt weit unter den 64 KB,
    // die dafür erlaubt sind.
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: anpassung.stage,
      defaultSince: anpassung.defaultSince,
      interest: anpassung.interest === undefined ? undefined : anpassung.interest ? 'on' : 'off',
      baseRate: anpassung.baseRate,
      customerType: anpassung.customerType,
      // Der Brief fürs PDF.
      text: params.text,
      // Das Begleitschreiben der E-Mail. Es wird nur mitgeschickt, wenn auch
      // gesendet wird — gespeichert wird es nirgends.
      send: params.senden,
      ...(params.senden && params.mail
        ? {
            recipientEmail: params.mail.empfaenger,
            emailSubject: params.mail.betreff,
            emailBody: params.mail.text,
          }
        : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Die Mahnung konnte nicht erstellt werden.'))
  }
  return (await response.json()) as MahnungAnlegenErgebnis
}

/**
 * Eine bereits erstellte Mahnung (noch einmal) per E-Mail verschicken.
 *
 * Ohne Text: Es gilt der vorbereitete, den der Server ohnehin baut. Ein
 * eigener Bildschirm dafür wäre eine Frage an jemanden, der gerade nur auf
 * „Senden" geklickt hat.
 */
export async function sendeMahnung(reminderId: string): Promise<{ empfaengerEmail: string }> {
  const response = await fetch(`/api/dunning/${reminderId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Die Mahnung konnte nicht versendet werden.'))
  }
  return (await response.json()) as { empfaengerEmail: string }
}

/** Eine noch nicht versendete Mahnung löschen. */
export async function verwirfMahnung(reminderId: string): Promise<void> {
  const response = await fetch(`/api/dunning/${reminderId}`, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Die Mahnung konnte nicht gelöscht werden.'))
  }
}
