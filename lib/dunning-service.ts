import type { SupabaseClient } from '@supabase/supabase-js'
import type { InterestResult } from './dunning-interest'
import type { DunningStageDefinition } from './dunning-stages'
import { istMahnbarerStatus, type Forderung } from './dunning-claim'
import { resolveSellerContact } from './contact-persons'
import type {
  BankDetails,
  Invoice,
  PartySnapshot,
  PaymentReminder,
  PaymentReminderInsert,
} from '../types'

/**
 * Die Schicht, die aus einer berechneten Forderung einen Datensatz macht.
 *
 * Aufgeteilt wie in `lib/invoice-service.ts`: Die Fachlogik steht hier, nicht
 * in den Routen — sonst laufen die Sitzungs-API und die Schlüssel-API wieder
 * auseinander. Jede Funktion bekommt einen bereits authentifizierten
 * Supabase-Client als ersten Parameter (Sitzung mit RLS oder Dienstschlüssel)
 * und wirft `DunningServiceError`, damit kein roher Datenbankfehler nach außen
 * dringt.
 *
 * Was hier **nicht** passiert, und zwar mit Absicht:
 *
 *  * **Kein Rechnen.** Die Forderung kommt fertig herein. Der Nutzer bekommt
 *    sie vorher zu sehen — mitsamt `hinweise` und dem `stale`-Kennzeichen —
 *    und was er bestätigt hat, wird genau so festgehalten. Würde der Service
 *    nachrechnen, könnte zwischen Anzeige und Speichern ein anderer Betrag
 *    entstehen (ein Tag später sind es andere Zinstage).
 *  * **Keine Umsatzsteuer.** Verzugszinsen und Mahnkosten sind Schadensersatz,
 *    kein Leistungsaustausch. Eine Mahnung trägt deshalb keine Steuerzeile,
 *    und `payment_reminders` hat bewusst kein `vat_amount`.
 *  * **Keine Rechnungsnummer.** Eine Mahnung ist kein Beleg nach § 14 UStG und
 *    darf den fortlaufenden Rechnungskreis nicht anfassen.
 *  * **Kein PDF, kein Versand, kein Statuswechsel der Rechnung.** Eine Rechnung
 *    wird `reminded`, wenn die Mahnung das Haus verlässt — nicht, wenn jemand
 *    einen Entwurf anlegt und ihn womöglich wieder verwirft.
 */

export class DunningServiceError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'DunningServiceError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Die Firma, in deren Namen gemahnt wird. Der Client trägt die Identität. */
export interface DunningCtx {
  companyId: string
}

// Lose typisiert wie in lib/invoice-service.ts: die Clients dieses Projekts
// sind nicht über den Database-Typ generisch, bieten aber dieselbe Abfrage-API.
type Db = SupabaseClient

// ---------------------------------------------------------------------------
// 1. Die reine Abbildung: Forderung -> Datensatz
// ---------------------------------------------------------------------------

type Zinsgrundlagen = Pick<
  PaymentReminderInsert,
  'interest_segments' | 'interest_rate' | 'base_rate' | 'interest_from' | 'interest_days'
>

/**
 * Die Zinsgrundlagen einfrieren.
 *
 * Hier wird die Frage entschieden, die das Schema offen gelassen hatte: Eine
 * Forderung, die über den 1. Januar oder den 1. Juli hinweg offen ist, trägt
 * **mehrere** Sätze. `interest_segments` hält sie alle fest und ist damit die
 * einzige Fassung, aus der sich der Betrag nachrechnen lässt.
 *
 * Die Skalare daneben sind nur noch Anzeigewerte:
 *
 *  * `interest_rate` / `base_rate` werden nur gesetzt, wenn der gesamte
 *    Zeitraum **einen** Satz trägt. Sonst bleiben sie NULL. Der naheliegende
 *    Ausweg wäre `effectiveRate` — aber der ist laut seiner eigenen
 *    Dokumentation ein tagesgewichteter Durchschnitt und nur zur Anzeige
 *    gedacht; wer damit multipliziert, landet wegen der abschnittsweisen
 *    Rundung neben `interest_amount`. Eine Zahl, die aussieht wie eine
 *    Feststellung und keine ist, ist schlimmer als eine ehrliche Lücke: die
 *    Lücke zwingt zum Blick in die Abschnitte.
 *  * `interest_from` und `interest_days` bleiben dagegen auch über mehrere
 *    Abschnitte hinweg eindeutig — der erste Zinstag ist der erste Zinstag,
 *    und die Zinstage addieren sich. Nur die Sätze tun das nicht.
 *
 * Maßgeblich ist die Anzahl **verschiedener Sätze**, nicht die Anzahl der
 * Abschnitte: `computeDefaultInterest` teilt auch an jedem Jahreswechsel, um
 * den richtigen Teiler (365/366) zu bekommen. Lag der Basiszinssatz über den
 * Jahreswechsel hinweg unverändert — zwischen 2016 und 2022 war er das jahrelang
 * —, gibt es zwei Abschnitte und trotzdem genau einen Satz, der gedruckt werden
 * kann.
 */
export function friereZinsgrundlagenEin(zinsDetails: InterestResult | null): Zinsgrundlagen {
  const segmente = zinsDetails?.segments ?? []

  // Kein Verzug, keine Zinsen, keine Grundlagen. Nicht etwa Nullwerte — eine 0
  // als Zinssatz wäre eine Aussage, und hier wurde nichts ausgesagt.
  if (segmente.length === 0) {
    return {
      interest_segments: null,
      interest_rate: null,
      base_rate: null,
      interest_from: null,
      interest_days: null,
    }
  }

  const einSatz = new Set(segmente.map((s) => s.ratePercent)).size === 1
  const einBasiszins = new Set(segmente.map((s) => s.baseRate)).size === 1

  return {
    // Der Umweg über `unknown`: InterestSegment ist ein Interface und damit
    // nicht automatisch auf den Json-Typ abbildbar, obwohl es nur aus Zahlen,
    // Zeichenketten und Wahrheitswerten besteht.
    interest_segments: segmente as unknown as PaymentReminderInsert['interest_segments'],
    interest_rate: einSatz ? zinsDetails!.effectiveRate : null,
    base_rate: einBasiszins ? segmente[0].baseRate : null,
    interest_from: segmente[0].from,
    interest_days: zinsDetails!.days,
  }
}

export interface MahnungsDatensatzInput {
  companyId: string
  invoiceId: string
  stufe: DunningStageDefinition
  /** Ergebnis von `berechneForderung()` — genau so, wie es dem Nutzer gezeigt wurde. */
  forderung: Forderung
  /** Datum der Mahnung; zugleich der Stichtag, mit dem gerechnet wurde. */
  reminderDate: string
  /**
   * Der Verzugsbeginn: Ergebnis von `verzugsbeginn()`, einschließlich des
   * 30-Tage-Bodens aus § 286 Abs. 3 BGB. Das Schreiben sagt damit „Sie
   * befinden sich seit dem … in Verzug", und daran hängt der Zinszeitraum.
   */
  defaultSince: string
  /**
   * Die Fälligkeit der Rechnung, roh aus `invoices.due_date` — für „zahlbar
   * bis …" auf dem Schreiben. **Nicht** dasselbe wie `defaultSince`: Bei einem
   * einseitig verkürzten Zahlungsziel liegt der Verzugsbeginn später, und wer
   * hier den Verzugsbeginn druckte, druckte eine Fälligkeit, die nie auf der
   * Rechnung stand. `null`, wenn die Rechnung keine trägt.
   */
  invoiceDueDate: string | null
  language: string
  /**
   * Der vom Nutzer bearbeitete Schreibtext. Ohne Angabe gilt der Text der
   * Stufe. Er wird hier eingefroren wie jede andere Angabe des Dokuments:
   * Wird die Stufe später umformuliert, darf sich ein bereits geschriebenes
   * Mahnschreiben nicht rückwirkend ändern.
   */
  introText?: string | null
  sellerSnapshot: PartySnapshot | null
  buyerSnapshot: PartySnapshot | null
  recipientEmail: string | null
  /**
   * Nur beim Ablösen gesetzt: Die neue Fassung wird zunächst *geparkt*
   * eingefügt und zeigt auf die Fassung, die sie ersetzen soll. Warum, steht
   * bei `ersetzeMahnung` und in Abschnitt 5 der Migration 040.
   */
  supersededBy?: string | null
}

/**
 * Aus Rechnung, Stufe und berechneter Forderung ein Datensatz.
 *
 * Rein und ohne Datenbank, damit das Einfrieren prüfbar ist — eine Funktion,
 * die nur Felder zuordnet, ist genau dort am wertvollsten, wo sie etwas
 * festhält, das sich später nicht mehr ändern darf.
 *
 * Eingefroren wird **alles, was das Dokument zeigt**: Stufe samt Name, sämtliche
 * Beträge, die Zinsgrundlagen, die Fälligkeit der Rechnung, beide Parteien und
 * die Sprache. Dieselbe Ueberlegung wie bei `seller_snapshot`/`buyer_snapshot`
 * auf `invoices`: Wird die Stufe später umbenannt, der Kontakt bearbeitet oder
 * der Basiszinssatz fortgeschrieben, bleibt diese Mahnung, was sie war.
 *
 * Kein Fremdschlüssel auf `dunning_stages` — nur Position und Name werden
 * kopiert. Wer seine Stufen löscht ("auf Standard zurücksetzen"), verliert
 * sonst seine Mahnungen gleich mit.
 */
export function baueMahnungsDatensatz(input: MahnungsDatensatzInput): PaymentReminderInsert {
  const { forderung, stufe } = input

  return {
    company_id: input.companyId,
    invoice_id: input.invoiceId,

    // Die Stufe als Kopie, nicht als Verweis.
    stage_position: stufe.position,
    stage_name: stufe.name,

    // Ein Entwurf. Versendet wird später und anderswo; bis dahin bleibt
    // sent_at leer, und nur in diesem Zustand lässt die Löschregel der
    // Tabelle die Mahnung wieder verschwinden.
    status: 'created',
    sent_at: null,

    reminder_date: input.reminderDate,
    due_date: forderung.neueFrist,
    default_since: input.defaultSince,
    invoice_due_date: input.invoiceDueDate,

    claimed_amount: forderung.offenerBetrag,
    fee_amount: forderung.gebuehr,
    late_fee_flat: forderung.pauschale,
    interest_amount: forderung.zinsen,
    ...friereZinsgrundlagenEin(forderung.zinsDetails),
    // Aus `summe` und nicht hier neu addiert: der CHECK
    // payment_reminders_total_is_sum rechnet in NUMERIC exakt nach, und die
    // Summe der gerundeten Teile ist genau das, was dem Nutzer gezeigt wurde.
    total_amount: forderung.summe,

    seller_snapshot: input.sellerSnapshot as PaymentReminderInsert['seller_snapshot'],
    buyer_snapshot: input.buyerSnapshot as PaymentReminderInsert['buyer_snapshot'],

    language: input.language,
    // Der bearbeitete Text gewinnt; NULL heißt "Standardtext der Stufe".
    // Ein leerer Text ist dabei eine Angabe des Nutzers und kein fehlender
    // Wert — wer alles löscht, will keinen Text, nicht den Stufentext zurück.
    intro_text: input.introText !== undefined ? input.introText : stufe.intro_text,
    outro_text: stufe.outro_text,

    recipient_email: input.recipientEmail,
    superseded_by: input.supersededBy ?? null,
  }
}

// ---------------------------------------------------------------------------
// 2. Die Parteien
// ---------------------------------------------------------------------------

/**
 * Der Absender der Mahnung.
 *
 * Gebaut wie in `lib/invoice-service.ts`: Steht die eigene Firma als
 * Verkäufer, kommen die Daten aus der Firmenzeile, wie sie **heute** aussieht;
 * bei einem fremden Verkäufer gibt es keine lebende Quelle, dort gilt der
 * Snapshot der Rechnung.
 *
 * Warum beim Absender die heutigen Daten und nicht die der Rechnung: Die
 * Mahnung ist ein neues Schreiben und fordert zur Zahlung auf. Ein inzwischen
 * gewechseltes Bankkonto auf der Mahnung zu drucken, nur weil es zur
 * Rechnungszeit so war, schickt das Geld ins Leere. Eingefroren wird trotzdem —
 * nur eben zum Zeitpunkt *dieses* Dokuments.
 */
export function baueVerkaeuferSnapshot(
  invoice: Invoice,
  // Die Firmenzeile ist im Projekt nirgends durchtypisiert.
   
  company: any
): PartySnapshot | null {
  if (!invoice.seller_is_self) {
    return (invoice.seller_snapshot as PartySnapshot | null) ?? null
  }

  const bank = company.bank_details as BankDetails | null
  return {
    name: company.name,
    address: company.address,
    vat_id: company.vat_id || undefined,
    tax_id: company.tax_id || undefined,
    bank_details: bank
      ? {
          bank_name: bank.bank_name,
          iban: bank.iban,
          bic: bank.bic,
          account_holder: bank.account_holder,
        }
      : undefined,
    contact: resolveSellerContact(company, invoice.contact_person_id),
    court: company.court || undefined,
    register_number: company.register_number || undefined,
    managing_director: company.managing_director || undefined,
  }
}

/**
 * Der Empfänger der Mahnung: der Snapshot der Rechnung, unverändert.
 *
 * Hier **nicht** der heutige Kontakt — anders als beim Absender. Der Schuldner
 * dieser Forderung ist, wer auf der Rechnung stand. Wird der Kontakt später
 * umbenannt oder für einen anderen Kunden weiterverwendet, darf die Mahnung
 * nicht stillschweigend jemand anderen in Anspruch nehmen.
 *
 * Eine mahnbare Rechnung ist immer finalisiert, und `finalizeInvoice` schreibt
 * `buyer_snapshot` in jedem Fall — auch wenn die eigene Firma der Käufer ist.
 */
export function baueKaeuferSnapshot(invoice: Invoice): PartySnapshot | null {
  return (invoice.buyer_snapshot as PartySnapshot | null) ?? null
}

// ---------------------------------------------------------------------------
// 3. Lesen
// ---------------------------------------------------------------------------

/**
 * Der Mahnverlauf einer Rechnung — **alle** Fassungen, abgelöste
 * eingeschlossen.
 *
 * Ungefiltert, weil die beiden Verwender es verschieden brauchen:
 * `naechsteStufe()` und `berechneForderung()` wollen die abgelösten Fassungen
 * sehen und selbst entscheiden (sie filtern intern über `superseded_by`), und
 * der Verlauf in der Oberfläche soll später zeigen können, dass einmal etwas
 * anderes verschickt wurde.
 */
export async function ladeMahnungen(
  supabase: Db,
  ctx: DunningCtx,
  invoiceId: string
): Promise<PaymentReminder[]> {
  const { data, error } = await supabase
    .from('payment_reminders')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('invoice_id', invoiceId)
    .order('stage_position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new DunningServiceError(500, 'SERVER_ERROR', 'Der Mahnverlauf konnte nicht geladen werden')
  }
  return (data ?? []) as PaymentReminder[]
}

async function ladeRechnungUndFirma(
  supabase: Db,
  ctx: DunningCtx,
  invoiceId: string
   
): Promise<{ invoice: Invoice; company: any }> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !invoice) throw new DunningServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')

  // Die Statusprüfung steht auch in `berechneForderung`. Sie wird hier
  // wiederholt, weil zwischen Berechnung und Speichern Zeit vergeht: Ist die
  // Rechnung inzwischen bezahlt oder storniert worden, gibt es nichts mehr zu
  // mahnen, und der Entwurf dürfte gar nicht erst entstehen.
  if (!istMahnbarerStatus((invoice as Invoice).status)) {
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      `Eine Rechnung im Status "${(invoice as Invoice).status}" kann nicht gemahnt werden.`
    )
  }

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', ctx.companyId)
    .single()
  if (!company) throw new DunningServiceError(404, 'NOT_FOUND', 'Firma nicht gefunden')

  return { invoice: invoice as Invoice, company }
}

// ---------------------------------------------------------------------------
// 4. Schreiben
// ---------------------------------------------------------------------------

export interface MahnungParams {
  invoiceId: string
  stufe: DunningStageDefinition
  /** Was dem Nutzer gezeigt und von ihm bestätigt wurde. */
  forderung: Forderung
  /** Datum der Mahnung. Es gibt bewusst keinen Standardwert "heute". */
  reminderDate: string
  /**
   * Ergebnis von `verzugsbeginn()`; siehe `MahnungsDatensatzInput`. Die
   * Fälligkeit der Rechnung steht nicht daneben — die liest der Service aus
   * der Rechnung, die er ohnehin lädt, und kann sie dort nicht verwechseln.
   */
  defaultSince: string
  /** Ohne Angabe die Adresse aus dem Empfänger-Snapshot. */
  recipientEmail?: string | null
  /** Der bearbeitete Schreibtext; ohne Angabe der Text der Stufe. */
  introText?: string | null
}

async function fuegeEin(supabase: Db, datensatz: PaymentReminderInsert): Promise<PaymentReminder> {
  const { data, error } = await supabase
    .from('payment_reminders')
    .insert(datensatz)
    .select()
    .single()

  if (error || !data) {
    // Der partielle eindeutige Index idx_payment_reminders_active_stage greift,
    // wenn zu dieser Rechnung bereits eine gültige Fassung derselben Stufe
    // existiert. Ohne eigene Behandlung sähe der Nutzer einen Serverfehler und
    // wüsste nicht, dass schon eine Mahnung dieser Stufe im Haus ist.
    if ((error as { code?: string } | null)?.code === '23505') {
      throw new DunningServiceError(
        409,
        'CONFLICT',
        `Zu dieser Rechnung gibt es bereits eine gültige Mahnung der Stufe ${datensatz.stage_position} („${datensatz.stage_name}"). Lösen Sie diese ab oder verwerfen Sie sie, bevor Sie eine neue anlegen.`
      )
    }
    throw new DunningServiceError(500, 'SERVER_ERROR', 'Die Mahnung konnte nicht gespeichert werden')
  }
  return data as PaymentReminder
}

function baueAusRechnung(
  ctx: DunningCtx,
  invoice: Invoice,
   
  company: any,
  params: MahnungParams,
  supersededBy: string | null
): PaymentReminderInsert {
  const buyerSnapshot = baueKaeuferSnapshot(invoice)
  return baueMahnungsDatensatz({
    companyId: ctx.companyId,
    invoiceId: invoice.id,
    stufe: params.stufe,
    forderung: params.forderung,
    reminderDate: params.reminderDate,
    defaultSince: params.defaultSince,
    invoiceDueDate: invoice.due_date,
    // Die Mahnung spricht die Sprache der Rechnung; ein Schuldner, der eine
    // englische Rechnung bekommen hat, soll keine deutsche Mahnung erhalten.
    language: invoice.language || 'de',
    sellerSnapshot: baueVerkaeuferSnapshot(invoice, company),
    buyerSnapshot,
    recipientEmail: params.recipientEmail ?? invoice.recipient_email ?? buyerSnapshot?.email ?? null,
    introText: params.introText,
    supersededBy,
  })
}

/**
 * Eine Mahnung als Entwurf anlegen.
 *
 * Der Status der Rechnung bleibt unberührt. `reminded` sagt aus, dass gemahnt
 * *wurde*, und das stimmt erst, wenn das Schreiben draußen ist — ein Entwurf
 * kann noch verworfen werden, und ein Status, der sich wieder zurücknehmen
 * müsste, ist kein Status.
 */
export async function erstelleMahnung(
  supabase: Db,
  ctx: DunningCtx,
  params: MahnungParams
): Promise<PaymentReminder> {
  const { invoice, company } = await ladeRechnungUndFirma(supabase, ctx, params.invoiceId)
  return fuegeEin(supabase, baueAusRechnung(ctx, invoice, company, params, null))
}

export interface ErsatzParams extends Omit<MahnungParams, 'invoiceId'> {
  /** Die Fassung, die ersetzt wird: gültig, bereits verschickt, gleiche Stufe. */
  abzuloesendeId: string
}

/**
 * Eine bereits verschickte Mahnung durch eine neue Fassung ablösen.
 *
 * Eine verschickte Mahnung ist ein Handelsbrief und wird nicht überschrieben.
 * Die Korrektur entsteht als neue Zeile; die alte bleibt lesbar und trägt den
 * Verweis auf ihre Nachfolgerin.
 *
 * Der heikle Teil ist die Reihenfolge. Der partielle eindeutige Index
 * `(invoice_id, stage_position) WHERE superseded_by IS NULL` lässt je Stufe nur
 * **eine** gültige Fassung zu, und eine Ablösung muss zwei Zeilen gleichzeitig
 * bewegen. Beide naheliegenden Reihenfolgen scheitern:
 *
 *  * Die neue Fassung zuerst als gültig einfügen — die alte steht noch auf
 *    gültig, der Index schlägt zu.
 *  * Zuerst die alte ablösen — `superseded_by` zeigt auf eine Zeile, die es
 *    noch nicht gibt, der Fremdschlüssel schlägt zu.
 *
 * Deshalb in drei Schritten, über einen Zustand, den der Index nicht kennt:
 *
 *  1. Die neue Fassung **geparkt** einfügen, mit `superseded_by` auf die alte.
 *     Sie ist damit selbst nicht gültig und fällt aus dem Index heraus; die
 *     alte bleibt vorerst die gültige Fassung.
 *  2. und 3. Die Gültigkeit tauschen — in der Datenbankfunktion
 *     `supersede_payment_reminder` und damit **in einer Transaktion**. Zwischen
 *     den beiden UPDATEs gibt es kurz gar keine gültige Fassung dieser Stufe;
 *     wären das zwei Aufrufe statt einer Funktion, wäre dieser Zustand
 *     sichtbar, und die Stufenermittlung würde die Stufe erneut anbieten und
 *     die 40-Euro-Pauschale falsch zählen.
 *
 * Bricht Schritt 1 ab, ist nichts passiert. Bricht der Tausch ab, bleibt nur
 * die geparkte Zeile übrig — unsichtbar für die Stufenermittlung, und die
 * alte Fassung ist unverändert gültig. Sie wird sofort wieder entfernt, so
 * wie `cancelInvoice` die angelegte Stornozeile zurücknimmt, wenn danach etwas
 * schiefgeht.
 */
export async function ersetzeMahnung(
  supabase: Db,
  ctx: DunningCtx,
  params: ErsatzParams
): Promise<PaymentReminder> {
  const { data: alt, error } = await supabase
    .from('payment_reminders')
    .select('*')
    .eq('id', params.abzuloesendeId)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !alt) throw new DunningServiceError(404, 'NOT_FOUND', 'Mahnung nicht gefunden')

  const abzulösende = alt as PaymentReminder

  if (abzulösende.superseded_by !== null) {
    throw new DunningServiceError(
      409,
      'CONFLICT',
      'Diese Mahnung wurde bereits durch eine neuere Fassung abgelöst.'
    )
  }
  if (abzulösende.status !== 'sent') {
    // Ablösen ist die Antwort auf "das Schreiben ist raus und war falsch".
    // Solange nichts raus ist, gibt es nichts zu bewahren: verwerfen und neu
    // anlegen ist ehrlicher als eine Kette von Fassungen, die nie jemand sah.
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      'Diese Mahnung wurde noch nicht versendet. Verwerfen Sie sie und legen Sie eine neue an, statt sie abzulösen.'
    )
  }
  if (params.stufe.position !== abzulösende.stage_position) {
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      `Eine Mahnung kann nur durch eine Fassung derselben Stufe abgelöst werden (Stufe ${abzulösende.stage_position}).`
    )
  }

  const { invoice, company } = await ladeRechnungUndFirma(supabase, ctx, abzulösende.invoice_id)

  // Schritt 1: geparkt einfügen.
  const neu = await fuegeEin(
    supabase,
    baueAusRechnung(ctx, invoice, company, { ...params, invoiceId: invoice.id }, abzulösende.id)
  )

  // Schritt 2 und 3: die Gültigkeit tauschen, in einer Transaktion.
  const { data: aktiviert, error: rpcError } = await supabase
    .rpc('supersede_payment_reminder', { p_old_id: abzulösende.id, p_new_id: neu.id })
    .single()

  if (rpcError || !aktiviert) {
    // Die geparkte Zeile wieder einsammeln. Scheitert auch das, bleibt eine
    // unsichtbare Leiche zurück — der ursprüngliche Fehler ist der
    // wichtigere und darf davon nicht verdeckt werden.
    try {
      await supabase
        .from('payment_reminders')
        .delete()
        .eq('id', neu.id)
        .eq('company_id', ctx.companyId)
    } catch {
      // bewusst verschluckt
    }
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      'Die bestehende Mahnung konnte nicht abgelöst werden; es wurde nichts geändert.'
    )
  }

  return aktiviert as PaymentReminder
}

/**
 * Eine noch nicht versendete Mahnung verwerfen.
 *
 * Nur Entwürfe — das setzt die Löschregel der Tabelle ohnehin durch, die
 * Bedingung steht hier zusätzlich, damit der Nutzer einen Satz statt einer
 * leeren Antwort bekommt.
 *
 * Nebenwirkung mit Absicht: War der Entwurf die Korrektur einer früheren
 * Fassung, macht `ON DELETE SET NULL` auf `superseded_by` die Vorgängerin
 * automatisch wieder zur gültigen Fassung. Das Verwerfen nimmt die Ablösung
 * also vollständig zurück.
 */
export async function verwerfeMahnung(
  supabase: Db,
  ctx: DunningCtx,
  reminderId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('payment_reminders')
    .delete()
    .eq('id', reminderId)
    .eq('company_id', ctx.companyId)
    .eq('status', 'created')
    .select('id')

  if (error) {
    throw new DunningServiceError(500, 'SERVER_ERROR', 'Die Mahnung konnte nicht verworfen werden')
  }
  if (!data || data.length === 0) {
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      'Die Mahnung wurde nicht gefunden oder ist bereits versendet. Versendete Mahnungen lassen sich nicht verwerfen.'
    )
  }
}

// ---------------------------------------------------------------------------
// 5. Hinweise ordnen
// ---------------------------------------------------------------------------

/**
 * Die Arten von Hinweis, die `berechneForderung` erzeugt.
 *
 * `unbekannt` ist der Platzhalter für einen Hinweis, den diese Datei noch
 * nicht kennt — ein später hinzugekommener Text soll nicht stillschweigend
 * ganz nach hinten rutschen und damit aus der Anzeige fallen.
 */
type HinweisArt =
  | 'basiszins-ungeprueft'
  | 'schuldnertyp-unbekannt'
  | 'verzug-nicht-eingetreten'
  | 'teilbetrag'
  | 'unbekannt'
  | 'pauschale-verbraucher'
  | 'pauschale-bereits-berechnet'
  | 'pauschale-typ-unbekannt'

/**
 * Erkennung über eine stabile Teilzeichenkette.
 *
 * Unschön, aber die ehrlichste Lösung an dieser Stelle: `berechneForderung`
 * liefert fertige Sätze und keine Kennungen, und dieses Modul darf die reine
 * Berechnung nicht umbauen, nur um sie zu sortieren. Damit die Zuordnung nicht
 * leise verfällt, wenn jemand dort einen Satz umformuliert, wacht
 * `tests/dunning-hinweise.test.ts` über die Marker — der Test lässt die echten
 * Hinweise erzeugen und prüft die Reihenfolge, nicht die Marker selbst.
 */
const HINWEIS_MARKER: ReadonlyArray<readonly [HinweisArt, string]> = [
  ['basiszins-ungeprueft', 'noch nicht als geprüft hinterlegt'],
  ['schuldnertyp-unbekannt', 'Vorsichtshalber werden nur'],
  ['verzug-nicht-eingetreten', 'Der Verzug beginnt erst'],
  ['teilbetrag', 'Sie mahnen einen Teilbetrag'],
  // Vor `pauschale-verbraucher`, weil beide Sätze mit derselben Wendung über
  // die Pauschale beginnen und sich erst in der Begründung unterscheiden.
  ['pauschale-typ-unbekannt', 'weil nicht hinterlegt ist, ob der Schuldner'],
  ['pauschale-verbraucher', 'nur gegenüber Unternehmen zu'],
  ['pauschale-bereits-berechnet', 'bereits mit einer früheren Mahnung berechnet'],
]

/**
 * Die Rangfolge. Kleiner heißt dringender.
 *
 * Leitgedanke: **Was die Forderung angreifbar macht, steht über dem, was sie
 * nur kleiner macht, und beides steht über dem, was nur erklärt.**
 *
 *  1. Ungeprüfter Basiszinssatz — der einzige Hinweis, der eine Handlung
 *     *vor* dem Versand verlangt. Die Zinsforderung stützt sich auf eine
 *     fortgeschriebene Zahl; stimmt sie nicht, ist der geforderte Betrag
 *     falsch und das Schreiben angreifbar.
 *  2. Unbekannter Schuldnertyp — eine Lücke in den eigenen Daten, die der
 *     Nutzer genau jetzt schließen kann, und die zugleich Zinssatz und
 *     Pauschale bestimmt.
 *  3. Verzug noch nicht eingetreten — ändert, was das Schreiben überhaupt
 *     fordern darf. Macht die Forderung kleiner, nicht falsch.
 *  4. Teilbetrag — betrifft die Höhe, ist aber vom Nutzer selbst so gewählt.
 *  5. Unbekannter neuer Hinweis — im Zweifel sichtbar lassen.
 *  6.–8. Die Pauschale-Hinweise erklären nur, warum die 40 € fehlen. Sie
 *     verlangen nichts und ändern nichts; sie stehen deshalb hinten und werden
 *     von der Begrenzung als Erste abgeschnitten.
 */
const HINWEIS_RANG: Record<HinweisArt, number> = {
  'basiszins-ungeprueft': 1,
  'schuldnertyp-unbekannt': 2,
  'verzug-nicht-eingetreten': 3,
  teilbetrag: 4,
  unbekannt: 5,
  'pauschale-verbraucher': 6,
  'pauschale-bereits-berechnet': 7,
  'pauschale-typ-unbekannt': 8,
}

function artVon(hinweis: string): HinweisArt {
  for (const [art, marker] of HINWEIS_MARKER) {
    if (hinweis.includes(marker)) return art
  }
  return 'unbekannt'
}

/** Höchstens so viele Hinweise gleichzeitig. */
export const HINWEIS_GRENZE = 3

/**
 * Hinweise nach Dringlichkeit ordnen und auf drei begrenzen.
 *
 * Vier Hinweise nebeneinander sind keine Hilfe mehr, sondern eine Textwand:
 * Wer sie überspringt, überspringt auch den wichtigen. Deshalb wird hier
 * ausgewählt statt nur sortiert — eine Oberfläche, die alles zeigt, zeigt
 * nichts.
 *
 * Eine Doppelung wird dabei aufgelöst: Ist der Schuldnertyp unbekannt, sagt
 * der allgemeine Hinweis das bereits samt Folgen für Zinssatz **und**
 * Pauschale. Der zusätzliche Pauschale-Hinweis wiederholte nur dessen zweite
 * Hälfte und kostete einen der drei Plätze.
 *
 * Reine Funktion, bewusst ohne Datenbank und ohne Next.js: So kann der Test
 * sie direkt gegen die echten Hinweise aus `berechneForderung` laufen lassen,
 * und der Versand in Iteration 6 kann dieselbe Auswahl treffen wie der Dialog.
 */
export function sortiereHinweise(
  hinweise: readonly string[],
  grenze: number = HINWEIS_GRENZE
): string[] {
  const eingestuft = hinweise.map((text) => ({ text, art: artVon(text) }))

  const typUnbekanntGenannt = eingestuft.some((h) => h.art === 'schuldnertyp-unbekannt')
  const ohneDoppelung = typUnbekanntGenannt
    ? eingestuft.filter((h) => h.art !== 'pauschale-typ-unbekannt')
    : eingestuft

  return [...ohneDoppelung]
    // Stabil: bei gleichem Rang bleibt die Reihenfolge, in der
    // `berechneForderung` die Hinweise erzeugt hat.
    .sort((a, b) => HINWEIS_RANG[a.art] - HINWEIS_RANG[b.art])
    .slice(0, grenze)
    .map((h) => h.text)
}
