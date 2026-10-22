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
   * Das Mahnschreiben als Datei. Bislang immer `null` — die Erzeugung kommt
   * erst noch. Die Dokumentenliste bietet den Knopf genau dann an, wenn hier
   * etwas steht; mehr ist später nicht zu tun.
   */
  pdf_url: string | null
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
 * Den Entwurf anlegen.
 *
 * Es wird genau das geschickt, was der Nutzer gesehen hat — dieselben Felder
 * wie bei der Abfrage. Der Server rechnet damit erneut und kommt deshalb auf
 * dieselbe Forderung; stimmte das nicht, stünde im Entwurf ein anderer Betrag
 * als im Prüfbildschirm, und der Prüfbildschirm wäre wertlos.
 */
export async function legeMahnungAn(
  invoiceId: string,
  anpassung: DunningAnpassung,
  text: string
): Promise<DunningVerlaufEintrag> {
  const response = await fetch(`/api/invoices/${invoiceId}/dunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: anpassung.stage,
      defaultSince: anpassung.defaultSince,
      interest: anpassung.interest === undefined ? undefined : anpassung.interest ? 'on' : 'off',
      baseRate: anpassung.baseRate,
      customerType: anpassung.customerType,
      // Der bearbeitete Schreibtext. Noch gibt es weder Versand noch PDF; das
      // Feld reist trotzdem mit, damit eine Änderung des Nutzers nicht
      // stillschweigend verfällt, sobald die Route sie annimmt.
      text,
    }),
  })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Der Entwurf konnte nicht angelegt werden.'))
  }
  return (await response.json()) as DunningVerlaufEintrag
}

/** Einen noch nicht versendeten Entwurf verwerfen. */
export async function verwirfMahnung(reminderId: string): Promise<void> {
  const response = await fetch(`/api/dunning/${reminderId}`, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await fehlertext(response, 'Der Entwurf konnte nicht verworfen werden.'))
  }
}
