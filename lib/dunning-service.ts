import type { SupabaseClient } from '@supabase/supabase-js'
import type { InterestResult } from './dunning-interest'
import type { DunningStageDefinition } from './dunning-stages'
import { istMahnbarerStatus, type Forderung } from './dunning-claim'
import { resolveReplyTo, resolveSellerContact } from './contact-persons'
import { generateReminderPDF, type MahnschreibenInput } from './reminder-pdf'
import { stufennameFuer } from './reminder-text'
import { downloadFromS3, uploadToS3 } from './s3'
import { getDefaultFromEmail, sendEmail, type SendEmailOptions } from './email'
import { textToHtml } from './email-templates'
import {
  formatCurrencyForLanguage,
  formatDateForLanguage,
  type InvoiceLanguage,
} from './invoice-translations'
import type {
  BankDetails,
  EmailSettings,
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
 *
 * **Anlegen, Erzeugen, Versenden — drei Schritte, in dieser Reihenfolge.**
 *
 *  1. `erstelleMahnung` schreibt nur die Zeile. Sie bleibt als Baustein
 *     bestehen, weil das Einfrieren für sich prüfbar sein soll.
 *  2. `erstelleMahnungMitSchreiben` legt zusätzlich das PDF ab und trägt
 *     `pdf_url` nach. Misslingt das, wird die eben angelegte Zeile wieder
 *     eingesammelt: Eine Mahnung ohne Dokument ist kein Zwischenstand, den
 *     man stehen lässt — man kann sie weder lesen noch verschicken, nur
 *     verwerfen. Dasselbe tut `cancelInvoice` mit der Stornozeile, wenn die
 *     Dokumente danach nicht entstehen.
 *  3. `versendeMahnung` schickt sie als E-Mail mit dem Schreiben im Anhang
 *     aus dem Haus — und **erst dort** wird die Rechnung `reminded`. Gemahnt
 *     *wurde*, wenn das Schreiben draußen ist; bis dahin gibt es nichts, was
 *     zurückgenommen werden müsste.
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

/**
 * Dasselbe, plus die Kennung des angemeldeten Nutzers.
 *
 * Nur für das Ablegen einer Datei nötig: `uploadToS3` legt unter
 * `invoices/{userId}/{invoiceId}/` ab, genau wie bei der Rechnung. Ein eigener
 * Typ statt eines Feldes an `DunningCtx`, damit jede Funktion, die ihn
 * verlangt, damit auch sagt, dass sie etwas ablegt.
 */
export interface DunningDokumentCtx extends DunningCtx {
  userId: string
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
// 5. Das Mahnschreiben als Datei
// ---------------------------------------------------------------------------

/**
 * Die Außenwelt dieses Moduls: erzeugen, ablegen, abholen, verschicken.
 *
 * Dahinter stehen `lib/reminder-pdf.ts`, `lib/s3.ts` und `lib/email/`. Dass
 * sie trotzdem als Parameter hereinkommen, hat genau einen Grund: Die
 * wichtigste Zusicherung dieses Moduls ist, dass nach einem **gescheiterten**
 * PDF keine Mahnung zurückbleibt — und ein Test, der das prüft, muss den
 * Fehlschlag herbeiführen können, ohne S3-Zugang und ohne eine E-Mail an einen
 * echten Schuldner zu schicken. Im Normalfall ändert sich nichts: Wer nichts
 * übergibt, bekommt `WERKZEUGE`.
 */
export interface MahnWerkzeuge {
  erzeugeSchreiben(input: MahnschreibenInput): Promise<Uint8Array>
  legeAb(userId: string, invoiceId: string, dateiname: string, inhalt: Buffer): Promise<string>
  holeAb(url: string): Promise<Buffer>
  verschicke(options: SendEmailOptions): Promise<void>
}

export const WERKZEUGE: MahnWerkzeuge = {
  erzeugeSchreiben: generateReminderPDF,
  legeAb: (userId, invoiceId, dateiname, inhalt) =>
    uploadToS3(userId, invoiceId, dateiname, inhalt, 'application/pdf'),
  holeAb: downloadFromS3,
  verschicke: sendEmail,
}

/**
 * Der Ablagename.
 *
 * Die Kennung der Mahnung steckt mit darin, und das ist nicht Vorsicht,
 * sondern nötig: Eine abgelöste Fassung derselben Stufe liegt daneben und
 * behält ihren Verweis. Hieße die Datei nur nach der Stufe, überschriebe die
 * neue Fassung das Schreiben der alten — die alte Zeile zeigte dann auf ein
 * Dokument, das sie nie war.
 */
function ablagename(mahnung: PaymentReminder): string {
  return `Mahnung-${mahnung.stage_position}-${mahnung.id}.pdf`
}

/**
 * Der Name, unter dem das Schreiben beim Empfänger ankommt.
 *
 * Hier zählt Lesbarkeit, nicht Eindeutigkeit: Im Postfach des Schuldners liegt
 * eine Datei, und „1. Mahnung RE-2026-001.pdf" sagt ihm, was er vor sich hat.
 * Was in Dateinamen Ärger macht, wird ersetzt.
 */
export function anhangname(stageName: string, invoiceNumber: string | null): string {
  const roh = [stageName, invoiceNumber].filter(Boolean).join(' ')
  return `${roh.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Mahnung'}.pdf`
}

/**
 * Das Schreiben erzeugen, ablegen und an der Mahnung vermerken.
 *
 * Alles aus dem eingefrorenen Datensatz — bis auf zwei Angaben, die dort nicht
 * stehen: Nummer und Datum der gemahnten Rechnung (die Tabelle verweist über
 * `invoice_id`) und das Logo, das Briefpapier ist und deshalb vom heutigen
 * Stand kommt.
 */
async function legeSchreibenAb(
  supabase: Db,
  ctx: DunningDokumentCtx,
  mahnung: PaymentReminder,
  invoice: Invoice,
  logoUrl: string | null,
  werkzeuge: MahnWerkzeuge
): Promise<PaymentReminder> {
  let pdf: Uint8Array
  try {
    pdf = await werkzeuge.erzeugeSchreiben({
      mahnung,
      rechnung: {
        nummer: invoice.invoice_number ?? '',
        // Eine mahnbare Rechnung ist festgeschrieben und trägt ein Datum. Der
        // Rückfall steht nur dafür ein, dass hier nichts Leeres aufs Blatt
        // gerät, falls doch einmal eines fehlt.
        datum: invoice.invoice_date ?? mahnung.reminder_date,
      },
      logoUrl: logoUrl ?? undefined,
    })
  } catch (err) {
    // `generateReminderPDF` formuliert seine Gründe bereits in Sie-Form
    // („kein Absender gespeichert"); sie werden durchgereicht, weil sie dem
    // Nutzer sagen, was ihm fehlt.
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      err instanceof Error ? err.message : 'Das Mahnschreiben konnte nicht erzeugt werden.'
    )
  }

  let pdfUrl: string
  try {
    pdfUrl = await werkzeuge.legeAb(ctx.userId, invoice.id, ablagename(mahnung), Buffer.from(pdf))
  } catch {
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      'Das Mahnschreiben konnte nicht abgelegt werden.'
    )
  }

  const { data, error } = await supabase
    .from('payment_reminders')
    .update({ pdf_url: pdfUrl })
    .eq('id', mahnung.id)
    .eq('company_id', ctx.companyId)
    .select()
    .single()

  if (error || !data) {
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      'Das Mahnschreiben konnte nicht an der Mahnung vermerkt werden.'
    )
  }
  return data as PaymentReminder
}

/**
 * Die eben angelegte Zeile wieder einsammeln.
 *
 * Fehler werden verschluckt: Der ursprüngliche Fehler ist der wichtigere und
 * darf davon nicht verdeckt werden — dieselbe Abwägung wie beim geparkten
 * Datensatz in `ersetzeMahnung`. `status = 'created'` steht dabei, weil die
 * Löschregel der Tabelle ohnehin nichts anderes zulässt.
 */
async function nimmMahnungZurueck(supabase: Db, ctx: DunningCtx, reminderId: string): Promise<void> {
  try {
    await supabase
      .from('payment_reminders')
      .delete()
      .eq('id', reminderId)
      .eq('company_id', ctx.companyId)
      .eq('status', 'created')
  } catch {
    // bewusst verschluckt
  }
}

/**
 * Eine Mahnung anlegen **und** ihr Schreiben erzeugen.
 *
 * Der Weg, den die Oberfläche geht. Entweder es entsteht eine Mahnung mit
 * Dokument oder gar keine: Scheitert das PDF oder die Ablage, verschwindet die
 * eben angelegte Zeile wieder, und der Nutzer bekommt den Grund zu lesen,
 * statt eine leere Mahnung vorzufinden, die er nur noch verwerfen kann.
 *
 * Warum die Zeile trotzdem zuerst entsteht und nicht erst nach dem PDF: Der
 * partielle eindeutige Index ist die einzige Stelle, die „zu dieser Stufe gibt
 * es schon eine gültige Mahnung" verlässlich entscheidet. Ein PDF, das vor dem
 * `INSERT` erzeugt würde, wäre bei zwei gleichzeitigen Anfragen für die
 * Katz — und die Mahnung trägt ihre Kennung im Dateinamen, die es vorher gar
 * nicht gibt.
 */
export async function erstelleMahnungMitSchreiben(
  supabase: Db,
  ctx: DunningDokumentCtx,
  params: MahnungParams,
  werkzeuge: MahnWerkzeuge = WERKZEUGE
): Promise<PaymentReminder> {
  const { invoice, company } = await ladeRechnungUndFirma(supabase, ctx, params.invoiceId)
  const mahnung = await fuegeEin(supabase, baueAusRechnung(ctx, invoice, company, params, null))

  try {
    return await legeSchreibenAb(
      supabase,
      ctx,
      mahnung,
      invoice,
      // Nur das eigene Logo: Steht ein fremder Verkäufer auf der Rechnung,
      // wäre unser Briefkopf auf seinem Mahnschreiben falsch. Dieselbe
      // Bedingung wie in `finalizeInvoice`.
      invoice.seller_is_self ? ((company.logo_url as string | null) ?? null) : null,
      werkzeuge
    )
  } catch (err) {
    await nimmMahnungZurueck(supabase, ctx, mahnung.id)
    throw err
  }
}

// ---------------------------------------------------------------------------
// 6. Versand
// ---------------------------------------------------------------------------

/**
 * Statusentscheidung für den Mahnungsversand.
 *
 * Gebaut nach `nextStatusAfterSend` in `lib/invoice-service.ts` und aus
 * demselben Grund: Ein Versand bewegt eine Rechnung nur **vorwärts**. Gemahnt
 * zu haben ist eine Station nach „verschickt" und vor „bezahlt" — also:
 *
 *  * `created` und `sent` gehen auf `reminded`. Das ist der Fortschritt, den
 *    dieser Versand ausmacht.
 *  * `reminded` bleibt. Die zweite Mahnung sagt nichts Neues über den Status.
 *  * `paid`, `cancelled`, `uneinbringlich` bleiben. Eine bezahlte Rechnung
 *    darf nicht auf „gemahnt" zurückfallen, nur weil jemand ein altes
 *    Schreiben noch einmal verschickt — der Status wäre dann schlicht falsch,
 *    und die Rechnung erschiene wieder unter den offenen Forderungen.
 *  * `draft` bleibt. Eine Rechnung, die nie draußen war, ist nicht gemahnt.
 *    (Der Versand lehnt sie ohnehin vorher ab, siehe `ladeFuerVersand`.)
 *
 * @returns den neuen Status oder `null`, wenn er unverändert bleibt.
 */
export function naechsterRechnungsstatusNachMahnung(
  currentStatus: string
): 'reminded' | null {
  return currentStatus === 'created' || currentStatus === 'sent' ? 'reminded' : null
}

/**
 * Der vorbereitete E-Mail-Text — das **Begleitschreiben**, nicht die Mahnung.
 *
 * Bewusst kurz und ohne Zahlenaufstellung: Was gefordert wird und warum, steht
 * im angehängten Mahnschreiben. Stünde es hier noch einmal, gäbe es zwei
 * Fassungen derselben Forderung, von denen nur eine das Dokument ist — und bei
 * einem bearbeiteten Schreiben liefen sie auseinander. Die E-Mail sagt deshalb
 * nur, was im Anhang liegt und bis wann gezahlt werden soll.
 *
 * **Eine Vorlage für beide Wege.** Die Mahn-Route legt diesen Text der
 * Schublade schon vor dem Anlegen vor (`mail` in der Lage), und derselbe Text
 * wird verschickt, wenn niemand ihn anfasst — auch beim Senden aus der
 * Belegübersicht heraus, wo gar kein Textfeld steht. Zwei Vorlagen liefen
 * irgendwann auseinander, und der Nutzer sähe etwas anderes, als beim
 * Empfänger ankommt.
 */
export function baueMahnungsMail(
  mahnung: Pick<
    PaymentReminder,
    'stage_name' | 'due_date' | 'total_amount' | 'language'
  >,
  invoiceNumber: string | null,
  absenderName: string
): { betreff: string; text: string } {
  const sprache: InvoiceLanguage = mahnung.language === 'en' ? 'en' : 'de'
  const nummer = invoiceNumber || (sprache === 'en' ? 'without number' : 'ohne Nummer')
  const betrag = formatCurrencyForLanguage(mahnung.total_amount, sprache)
  const frist = formatDateForLanguage(mahnung.due_date, sprache)
  const stufe = stufennameFuer(mahnung.stage_name, sprache)

  if (sprache === 'en') {
    return {
      betreff: `${stufe} – invoice ${nummer}`,
      text: [
        'Dear Sir or Madam,',
        `please find attached our ${stufe.toLowerCase()} regarding invoice ${nummer}.`,
        `The outstanding amount of ${betrag} is payable by ${frist}.`,
        `Kind regards\n${absenderName}`,
      ].join('\n\n'),
    }
  }

  return {
    betreff: `${stufe} – Rechnung ${nummer}`,
    text: [
      'Sehr geehrte Damen und Herren,',
      `im Anhang finden Sie unsere ${stufe} zur Rechnung ${nummer}.`,
      `Wir bitten Sie, den offenen Betrag von ${betrag} bis zum ${frist} zu überweisen.`,
      `Mit freundlichen Grüßen\n${absenderName}`,
    ].join('\n\n'),
  }
}

// Die Firmenzeile ist im Projekt nirgends durchtypisiert — wie in
// `baueVerkaeuferSnapshot` weiter oben.
 
type Firma = any

/**
 * Die Mahnung samt Rechnung und Firma laden — und prüfen, ob sie überhaupt
 * noch verschickt werden darf.
 *
 * Drei Gründe, aus denen hier abgebrochen wird, und jeder hat seinen eigenen
 * Satz:
 *
 *  * **Abgelöst.** Eine Fassung, die durch eine neuere ersetzt wurde, ist aus
 *    dem Verkehr gezogen. Sie zu verschicken hieße, dem Schuldner ein
 *    Schreiben zu schicken, das wir selbst nicht mehr gelten lassen.
 *  * **Ohne Schreiben.** Mahnungen aus der Zeit vor der PDF-Erzeugung tragen
 *    kein `pdf_url`. Eine Mahn-E-Mail ohne Mahnung im Anhang wäre keine.
 *  * **Die Rechnung ist nicht mehr mahnbar.** Bezahlt, storniert,
 *    abgeschrieben — dann ist das Schreiben gegenstandslos, und es zu
 *    verschicken wäre peinlich und nicht nur falsch.
 */
async function ladeFuerVersand(
  supabase: Db,
  ctx: DunningCtx,
  reminderId: string
): Promise<{ mahnung: PaymentReminder; invoice: Invoice; company: Firma }> {
  const { data, error } = await supabase
    .from('payment_reminders')
    .select('*')
    .eq('id', reminderId)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !data) throw new DunningServiceError(404, 'NOT_FOUND', 'Mahnung nicht gefunden')

  const mahnung = data as PaymentReminder

  if (mahnung.superseded_by !== null) {
    throw new DunningServiceError(
      409,
      'CONFLICT',
      'Diese Mahnung wurde durch eine neuere Fassung abgelöst und kann nicht mehr versendet werden.'
    )
  }
  if (!mahnung.pdf_url) {
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      'Zu dieser Mahnung gibt es kein Mahnschreiben. Verwerfen Sie sie und legen Sie eine neue an.'
    )
  }

  const { invoice, company } = await ladeRechnungUndFirma(supabase, ctx, mahnung.invoice_id)
  return { mahnung, invoice, company }
}

/**
 * Die Unterschrift unter dem Begleitschreiben: der eingefrorene Absender.
 *
 * Nicht der heutige Firmenname — das Mahnschreiben im Anhang ist mit dem
 * Namen unterschrieben, der im Snapshot steht, und die E-Mail darf daneben
 * keinen anderen nennen.
 */
function absenderName(mahnung: PaymentReminder, company: Firma): string {
  const snapshot = mahnung.seller_snapshot as PartySnapshot | null
  return snapshot?.name || (company.name as string) || ''
}

/**
 * An wen das Schreiben geht.
 *
 * Reihenfolge nach Nähe zum Vorgang: die an der Mahnung festgehaltene Adresse,
 * dann die der Rechnung, zuletzt die aus dem Empfänger-Snapshot.
 */
function empfaengerAdresse(mahnung: PaymentReminder, invoice: Invoice): string | null {
  const kaeufer = mahnung.buyer_snapshot as PartySnapshot | null
  return mahnung.recipient_email || invoice.recipient_email || kaeufer?.email || null
}

export interface VersandParams {
  reminderId: string
  /** Abweichende Empfängeradresse; ohne Angabe die hinterlegte. */
  recipientEmail?: string | null
  /** Betreff und Text der **E-Mail**; ohne Angabe der vorbereitete. */
  subject?: string
  body?: string
}

export interface VersandErgebnis {
  mahnung: PaymentReminder
  empfaengerEmail: string
  /** Wahr, wenn dieselbe Mahnung schon einmal draußen war. */
  erneut: boolean
  /** Der neue Rechnungsstatus, oder `null`, wenn er unverändert blieb. */
  rechnungsStatus: 'reminded' | null
}

/**
 * Die Mahnung verschicken: E-Mail mit dem Mahnschreiben im Anhang.
 *
 * **Ein zweiter Versand ist erlaubt** — der Kunde hat die Mail verlegt, die
 * Adresse war falsch, der Beleg wird noch einmal gebraucht. Verboten wäre nur
 * eine Scheinsicherheit: Wer nicht erneut senden darf, legt stattdessen eine
 * zweite Mahnung derselben Stufe an, und die zählt dann als weitere Mahnung
 * mit.
 *
 * **`sent_at` bleibt dabei stehen.** Der Tag des ersten Versands ist der Tag,
 * an dem das Schreiben den Schuldner erreicht hat; daran hängen die Fristen
 * dieser Stufe und der Abstand zur nächsten. Ihn auf die Wiederholung zu
 * setzen, machte die eigene Mahnung jünger, als sie ist — die nächste Stufe
 * rückte nach hinten, obwohl nichts passiert ist.
 */
export async function versendeMahnung(
  supabase: Db,
  ctx: DunningCtx,
  params: VersandParams,
  werkzeuge: MahnWerkzeuge = WERKZEUGE
): Promise<VersandErgebnis> {
  const { mahnung, invoice, company } = await ladeFuerVersand(supabase, ctx, params.reminderId)

  const empfaenger = params.recipientEmail?.trim() || empfaengerAdresse(mahnung, invoice)
  if (!empfaenger) {
    throw new DunningServiceError(
      400,
      'VALIDATION_ERROR',
      'Für diese Mahnung ist keine E-Mail-Adresse hinterlegt. Bitte tragen Sie eine ein.'
    )
  }

  const vorbereitet = baueMahnungsMail(
    mahnung,
    invoice.invoice_number,
    absenderName(mahnung, company)
  )
  const betreff = params.subject?.trim() || vorbereitet.betreff
  // Anders als beim Betreff gewinnt hier auch ein leerer Text: Wer alles
  // löscht, will eine E-Mail ohne Begleitzeilen — das Schreiben hängt ja an.
  const text = params.body ?? vorbereitet.text

  // Absender, Antwortadresse und eigene Domain genau wie beim
  // Rechnungsversand (`sendInvoice`). Eine Mahnung, die aus einer anderen
  // Adresse käme als die Rechnung, sähe nach Inkassobüro aus.
  const emailSettings = ((company.email_settings as EmailSettings) || { mode: 'default' })
  const eigeneDomain =
    emailSettings.mode === 'custom_domain' &&
    emailSettings.domain_verified &&
    !!emailSettings.from_email
  const fromEmail = eigeneDomain ? emailSettings.from_email! : getDefaultFromEmail()
  const fromName = eigeneDomain ? emailSettings.from_name : (company.name as string)
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail

  let anhang: Buffer
  try {
    anhang = await werkzeuge.holeAb(mahnung.pdf_url!)
  } catch {
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      'Das Mahnschreiben konnte nicht geladen werden; es wurde nichts versendet.'
    )
  }

  try {
    await werkzeuge.verschicke({
      from,
      to: empfaenger,
      subject: betreff,
      htmlBody: textToHtml(text),
      textBody: text,
      replyTo: resolveReplyTo(invoice, emailSettings),
      attachments: [
        {
          name: anhangname(
            stufennameFuer(mahnung.stage_name, mahnung.language === 'en' ? 'en' : 'de'),
            invoice.invoice_number
          ),
          content: anhang.toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    })
  } catch (err) {
    throw new DunningServiceError(
      500,
      'SERVER_ERROR',
      err instanceof Error ? err.message : 'Die E-Mail konnte nicht versendet werden.'
    )
  }

  // Ab hier ist das Schreiben aus dem Haus. Was jetzt noch misslingt, darf den
  // Aufruf nicht scheitern lassen: Eine Fehlermeldung läse sich wie „nicht
  // versendet" und brächte den Nutzer dazu, dem Schuldner dasselbe Schreiben
  // gleich noch einmal zu schicken. Dieselbe Abwägung wie in `sendInvoice`.
  const erneut = mahnung.sent_at !== null
  const aenderung: Record<string, unknown> = {
    status: 'sent',
    recipient_email: empfaenger,
    ...(erneut ? {} : { sent_at: new Date().toISOString() }),
  }
  const { data: aktualisiert } = await supabase
    .from('payment_reminders')
    .update(aenderung)
    .eq('id', mahnung.id)
    .eq('company_id', ctx.companyId)
    .select()
    .single()

  const rechnungsStatus = naechsterRechnungsstatusNachMahnung(invoice.status)
  if (rechnungsStatus) {
    await supabase
      .from('invoices')
      .update({ status: rechnungsStatus })
      .eq('id', invoice.id)
      .eq('company_id', ctx.companyId)
  }

  return {
    mahnung: (aktualisiert as PaymentReminder | null) ?? ({ ...mahnung, ...aenderung } as PaymentReminder),
    empfaengerEmail: empfaenger,
    erneut,
    rechnungsStatus,
  }
}

// ---------------------------------------------------------------------------
// 7. Hinweise ordnen
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
