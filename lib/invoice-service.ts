import type { SupabaseClient } from '@supabase/supabase-js'
import type { Invoice as DBInvoice, PartySnapshot, LineItem, EmailSettings, CustomerSnapshot, Contact } from '@/types'
import { generateInvoicePDF } from './pdf-generator'
import { generateXRechnungXML } from './zugferd-generator'
import { uploadToS3, downloadFromS3 } from './s3'
import { mapDBInvoiceToPDFInvoice } from './invoice-mapper'
import { validateXRechnungInvoice } from './schema'
import { sendEmail, getDefaultFromEmail } from './email'
import { textToHtml, generateEmailSubject, generateEmailBody } from './email-templates'
import { getBillingState, TRIAL_EXPIRED_MESSAGE, TRIAL_EXPIRED_DETAILS } from './billing'
import { resolveInvoiceTexts } from './invoice-texts'
import { getAdditionalContacts, resolveSellerContact, resolveReplyTo } from './contact-persons'
import { buildDuplicateDraft, DuplicateNotAllowedError } from './invoice-duplicate'

/**
 * Shared invoice business logic, used by both the session API (app/api/*) and
 * the public API-key API (app/api/v1/*). The routes are thin auth+marshalling
 * shells; all the orchestration (snapshots, atomic numbering, PDF/XML, S3,
 * status transitions) lives here so the two surfaces can never diverge again.
 *
 * Each function takes an already-authenticated Supabase client (session-RLS or
 * service-role) plus the resolved { companyId, userId }, and throws
 * InvoiceServiceError on any failure (no raw DB errors leak to callers).
 */

export class InvoiceServiceError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'InvoiceServiceError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ServiceCtx {
  companyId: string
  userId: string
}

// Loosely typed because the project's Supabase clients are not generic over the
// Database type; both factories expose the same query API.
type Db = SupabaseClient

interface NumberResult {
  next_number: number
  formatted_number: string
}

/** Session routes: verify the user belongs to the company before acting. */
export async function assertCompanyMembership(supabase: Db, userId: string, companyId: string): Promise<void> {
  const { data } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .single()
  if (!data) throw new InvoiceServiceError(403, 'FORBIDDEN', 'Kein Zugriff auf diese Firma')
}

function buildSellerSnapshot(dbInvoice: DBInvoice, company: any): PartySnapshot {
  if (dbInvoice.seller_is_self) {
    const bankDetails = company.bank_details as any
    return {
      name: company.name,
      address: company.address as any,
      vat_id: company.vat_id || undefined,
      tax_id: company.tax_id || undefined,
      bank_details: bankDetails
        ? { bank_name: bankDetails.bank_name, iban: bankDetails.iban, bic: bankDetails.bic, account_holder: bankDetails.account_holder }
        : undefined,
      contact: resolveSellerContact(company, dbInvoice.contact_person_id),
      // Legal info for the PDF footer (XRechnung-relevant for companies)
      court: company.court || undefined,
      register_number: company.register_number || undefined,
      managing_director: company.managing_director || undefined,
    }
  }
  const existing = dbInvoice.seller_snapshot as PartySnapshot | null
  if (!existing) throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Absender (Verkäufer) fehlt')
  return existing
}

/**
 * Das hinterlegte Präfix, so wie es die Datenbank erwartet.
 *
 * `null` bedeutet dort "nimm das gespeicherte", der Leerstring dagegen
 * ausdrücklich "kein Präfix". Ein `|| 'INV'` würde die bewusste Leerung
 * wieder in ein Präfix verwandeln — genau daran scheiterte bisher jeder
 * Versuch, einen bestehenden Nummernkreis ohne Präfix fortzuführen.
 */
function praefixOder(gespeichert: string | null | undefined, standard = 'INV'): string {
  return typeof gespeichert === 'string' ? gespeichert : standard
}

async function nextInvoiceNumber(supabase: Db, inv: DBInvoice, company: any): Promise<string> {
  if (inv.seller_is_self) {
    const { data, error } = (await supabase
      .rpc('get_next_invoice_number', { p_seller_type: 'company', p_seller_id: inv.company_id, p_prefix: praefixOder(company.invoice_number_prefix) })
      .single()) as { data: NumberResult | null; error: any }
    if (error || !data) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Rechnungsnummer konnte nicht erzeugt werden')
    return data.formatted_number
  }
  const sellerContact = inv.seller_snapshot as PartySnapshot | null
  if (typeof sellerContact?.invoice_number_prefix === 'string' && inv.seller_contact_id) {
    const { data, error } = (await supabase
      .rpc('get_next_invoice_number', { p_seller_type: 'contact', p_seller_id: inv.seller_contact_id, p_prefix: sellerContact.invoice_number_prefix })
      .single()) as { data: NumberResult | null; error: any }
    if (error || !data) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Rechnungsnummer konnte nicht erzeugt werden')
    return data.formatted_number
  }
  throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Rechnungsnummer für externen Verkäufer ohne Präfix erforderlich')
}

export interface FinalizeResult {
  invoice: DBInvoice
  pdfUrl: string
  xmlUrl: string
}

export async function finalizeInvoice(supabase: Db, ctx: ServiceCtx, invoiceId: string): Promise<FinalizeResult> {
  // The paywall. Drafting, contacts and existing invoices stay free forever;
  // access is only required at the moment an invoice becomes a legal document.
  const billing = await getBillingState(supabase, ctx.companyId)
  if (!billing.entitled) {
    throw new InvoiceServiceError(402, 'PAYMENT_REQUIRED', TRIAL_EXPIRED_MESSAGE, TRIAL_EXPIRED_DETAILS)
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .in('status', ['draft', 'created']) // allow retry of a partially-finalized invoice
    .single()
  if (error || !invoice) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')

  const dbInvoice = invoice as DBInvoice
  const buyerSnapshot = dbInvoice.buyer_snapshot as PartySnapshot | null

  if (!buyerSnapshot && !dbInvoice.buyer_is_self) {
    throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Empfänger fehlt')
  }
  if (!dbInvoice.buyer_is_self && !dbInvoice.buyer_contact_id) {
    throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Empfänger fehlt', 'Bitte wählen Sie einen Empfänger aus bevor Sie die Rechnung finalisieren.')
  }
  if (!dbInvoice.seller_is_self && !dbInvoice.seller_contact_id) {
    throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Absender fehlt', 'Bitte wählen Sie einen Absender aus bevor Sie die Rechnung finalisieren.')
  }

  const { data: company } = await supabase.from('companies').select('*').eq('id', dbInvoice.company_id).single()
  if (!company) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Firma nicht gefunden')

  const sellerSnapshot = buildSellerSnapshot(dbInvoice, company)
  const finalBuyerSnapshot: PartySnapshot = dbInvoice.buyer_is_self
    ? { name: company.name, address: company.address as any, vat_id: company.vat_id || undefined }
    : buyerSnapshot!

  const language = (dbInvoice.language as 'de' | 'en') || 'de'
  const defaultTexts = resolveInvoiceTexts(company, language)
  const introText = dbInvoice.intro_text || defaultTexts.introText
  const outroText = dbInvoice.outro_text || defaultTexts.outroText
  const buyerReference = (dbInvoice as any).buyer_reference || null

  // Assign an atomic invoice number if the draft doesn't have one yet.
  let invoiceNumber = dbInvoice.invoice_number
  if (!invoiceNumber) {
    invoiceNumber = await nextInvoiceNumber(supabase, dbInvoice, company)
    dbInvoice.invoice_number = invoiceNumber
  }

  const pdfInvoice = mapDBInvoiceToPDFInvoice(
    dbInvoice,
    sellerSnapshot,
    finalBuyerSnapshot,
    dbInvoice.seller_is_self ? (company as any).logo_url : null,
    introText,
    outroText,
    buyerReference,
    { kleinunternehmer: (company as any)?.kleinunternehmer === true }
  )

  const validation = validateXRechnungInvoice(pdfInvoice)
  if (!validation.valid) {
    throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'XRechnung-Validierung fehlgeschlagen', validation.errors)
  }

  let pdfBuffer: Uint8Array
  let xmlString: string
  try {
    pdfBuffer = await generateInvoicePDF(pdfInvoice, language, {
      showGirocode: (company as any).invoice_show_girocode !== false,
    })
    xmlString = await generateXRechnungXML(pdfInvoice)
  } catch {
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Fehler beim Erzeugen der Rechnungsdokumente')
  }

  let pdfUrl: string
  let xmlUrl: string
  try {
    pdfUrl = await uploadToS3(ctx.userId, invoiceId, `${invoiceNumber}.pdf`, Buffer.from(pdfBuffer), 'application/pdf')
    xmlUrl = await uploadToS3(ctx.userId, invoiceId, `${invoiceNumber}.xml`, Buffer.from(xmlString, 'utf-8'), 'application/xml')
  } catch {
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Fehler beim Hochladen der Dateien')
  }

  const updateData: Record<string, unknown> = {
    status: 'created',
    invoice_number: invoiceNumber,
    seller_snapshot: sellerSnapshot,
    buyer_snapshot: finalBuyerSnapshot,
    pdf_url: pdfUrl,
    xml_url: xmlUrl,
    intro_text: introText,
    outro_text: outroText,
    buyer_reference: buyerReference,
    // A contact person deleted since the draft was saved falls back to the
    // default, so the reply-to must fall back with it.
    contact_person_id:
      dbInvoice.seller_is_self && getAdditionalContacts(company).some((c) => c.id === dbInvoice.contact_person_id)
        ? dbInvoice.contact_person_id
        : null,
    finalized_at: new Date().toISOString(),
  }
  if (!dbInvoice.recipient_email && finalBuyerSnapshot?.email) {
    updateData.recipient_email = finalBuyerSnapshot.email
  }

  const { data: updated, error: updErr } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .in('status', ['draft', 'created'])
    .select()
    .single()
  if (updErr) {
    // Der Unique-Index idx_invoices_unique_number greift, wenn eine von Hand
    // eingetragene Nummer bereits vergeben ist. Ohne eigene Behandlung bekäme
    // der Nutzer einen Serverfehler und wüsste nicht, dass seine Nummer das
    // Problem ist.
    if ((updErr as { code?: string }).code === '23505') {
      throw new InvoiceServiceError(
        400,
        'VALIDATION_ERROR',
        `Die Rechnungsnummer ${invoiceNumber} ist in diesem Unternehmen bereits vergeben. Bitte tragen Sie eine andere ein oder lassen Sie das Feld leer.`
      )
    }
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Rechnung konnte nicht aktualisiert werden')
  }

  return { invoice: updated as DBInvoice, pdfUrl, xmlUrl }
}

export interface CancelResult {
  cancellationInvoice: DBInvoice
  originalInvoiceId: string
  originalInvoiceNumber: string | null
  cancellationNumber: string
  pdfUrl: string
  xmlUrl: string
}

export async function cancelInvoice(supabase: Db, ctx: ServiceCtx, invoiceId: string): Promise<CancelResult> {
  const { data: original, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !original) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')

  const dbInvoice = original as DBInvoice
  if (dbInvoice.status === 'draft') throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Entwürfe können nicht storniert werden.')
  if (dbInvoice.status === 'cancelled') throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Rechnung wurde bereits storniert.')
  if ((dbInvoice as any).invoice_type === 'cancellation') throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Eine Stornorechnung kann nicht storniert werden.')

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('company_id', ctx.companyId)
    .eq('cancelled_invoice_id', invoiceId)
    .maybeSingle()
  if (existing) throw new InvoiceServiceError(400, 'VALIDATION_ERROR', `Für diese Rechnung existiert bereits eine Stornorechnung (${(existing as any).invoice_number}).`)

  const { data: company } = await supabase.from('companies').select('*').eq('id', ctx.companyId).single()
  if (!company) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Firma nicht gefunden')

  // Atomic cancellation number (company or external-contact seller).
  let cancellationNumber: string
  if (dbInvoice.seller_is_self) {
    const { data, error: numErr } = (await supabase
      .rpc('get_next_cancellation_invoice_number', { p_seller_type: 'company', p_seller_id: ctx.companyId, p_prefix: praefixOder((company as any).cancellation_number_prefix, 'ST') })
      .single()) as { data: NumberResult | null; error: any }
    if (numErr || !data) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornonummer konnte nicht erzeugt werden')
    cancellationNumber = data.formatted_number
  } else {
    if (!dbInvoice.seller_contact_id) throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Stornonummer für externen Verkäufer ohne Kontakt-ID nicht möglich.')
    const { data, error: numErr } = (await supabase
      .rpc('get_next_cancellation_invoice_number', { p_seller_type: 'contact', p_seller_id: dbInvoice.seller_contact_id, p_prefix: null })
      .single()) as { data: NumberResult | null; error: any }
    if (numErr || !data) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornonummer konnte nicht erzeugt werden')
    cancellationNumber = data.formatted_number
  }

  const originalLineItems = (dbInvoice.line_items as unknown as LineItem[]) || []
  const negatedLineItems = originalLineItems.map((item) => ({
    ...item,
    quantity: -Math.abs(item.quantity),
    total: -Math.abs(item.total),
    vat_amount: item.vat_amount ? -Math.abs(item.vat_amount) : undefined,
  }))

  const cancellationData = {
    company_id: dbInvoice.company_id,
    status: 'created' as const,
    invoice_type: 'cancellation',
    invoice_number: cancellationNumber,
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: dbInvoice.due_date,
    service_date: (dbInvoice as any).service_date,
    seller_is_self: dbInvoice.seller_is_self,
    seller_contact_id: dbInvoice.seller_contact_id,
    seller_snapshot: dbInvoice.seller_snapshot,
    contact_person_id: dbInvoice.contact_person_id,
    buyer_is_self: dbInvoice.buyer_is_self,
    buyer_contact_id: dbInvoice.buyer_contact_id,
    buyer_snapshot: dbInvoice.buyer_snapshot,
    line_items: negatedLineItems,
    subtotal: -Math.abs(dbInvoice.subtotal),
    vat_amount: -Math.abs(dbInvoice.vat_amount),
    total_amount: -Math.abs(dbInvoice.total_amount),
    recipient_email: dbInvoice.recipient_email,
    language: dbInvoice.language,
    intro_text: dbInvoice.intro_text,
    outro_text: dbInvoice.outro_text,
    buyer_reference: (dbInvoice as any).buyer_reference,
    cancelled_invoice_id: invoiceId,
    finalized_at: new Date().toISOString(),
  }

  const { data: cancellation, error: insErr } = await supabase.from('invoices').insert(cancellationData).select().single()
  if (insErr || !cancellation) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornorechnung konnte nicht erstellt werden')

  const pdfInvoice = mapDBInvoiceToPDFInvoice(
    cancellation as DBInvoice,
    dbInvoice.seller_snapshot as unknown as PartySnapshot,
    dbInvoice.buyer_snapshot as unknown as PartySnapshot,
    dbInvoice.seller_is_self ? (company as any).logo_url : null,
    dbInvoice.intro_text,
    dbInvoice.outro_text,
    (dbInvoice as any).buyer_reference,
    { kleinunternehmer: (company as any)?.kleinunternehmer === true }
  )
  const language = (dbInvoice.language as 'de' | 'en') || 'de'
  const options = { isCancellation: true, originalInvoiceNumber: dbInvoice.invoice_number || undefined }

  let pdfBuffer: Uint8Array
  let xmlString: string
  try {
    pdfBuffer = await generateInvoicePDF(pdfInvoice, language, options)
    xmlString = await generateXRechnungXML(pdfInvoice, options)
  } catch {
    await supabase.from('invoices').delete().eq('id', cancellation.id).eq('company_id', ctx.companyId)
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornorechnungs-Dokumente konnten nicht erzeugt werden')
  }

  let pdfUrl: string
  let xmlUrl: string
  try {
    pdfUrl = await uploadToS3(ctx.userId, cancellation.id, `${cancellationNumber}.pdf`, Buffer.from(pdfBuffer), 'application/pdf')
    xmlUrl = await uploadToS3(ctx.userId, cancellation.id, `${cancellationNumber}.xml`, Buffer.from(xmlString, 'utf-8'), 'application/xml')
  } catch {
    await supabase.from('invoices').delete().eq('id', cancellation.id).eq('company_id', ctx.companyId)
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornorechnungs-Dateien konnten nicht hochgeladen werden')
  }

  const { data: updatedCancellation, error: updCancellationErr } = await supabase
    .from('invoices')
    .update({ pdf_url: pdfUrl, xml_url: xmlUrl })
    .eq('id', cancellation.id)
    .eq('company_id', ctx.companyId)
    .select()
    .single()
  if (updCancellationErr) {
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Stornorechnung konnte nicht aktualisiert werden')
  }

  const { error: originalUpdateErr } = await supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
  if (originalUpdateErr) {
    throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Originalrechnung konnte nicht als storniert markiert werden')
  }

  return {
    cancellationInvoice: (updatedCancellation || cancellation) as DBInvoice,
    originalInvoiceId: invoiceId,
    originalInvoiceNumber: dbInvoice.invoice_number,
    cancellationNumber,
    pdfUrl,
    xmlUrl,
  }
}

export interface SendOptions {
  recipientEmail?: string
  subject?: string
  body?: string
}

/**
 * Statusentscheidung für den Versand.
 *
 * Der Versand darf eine Rechnung im Lebenszyklus nur vorwärts bewegen, nie
 * zurück: `created` ist der einzige Zustand, in dem die Rechnung noch nie
 * draussen war — nur dort ist `sent` ein echter Fortschritt. Jeder andere
 * Zustand steht bereits gleich weit oder weiter, und ein erneuter Versand
 * desselben Dokuments (Kunde hat die Mail verlegt, Beleg zur Dokumentation)
 * sagt nichts darüber aus, dass eine Mahnung, eine Zahlung oder ein Storno
 * nicht stattgefunden hätte. Eine gemahnte Rechnung bleibt also `reminded`,
 * eine bezahlte `paid`, eine stornierte `cancelled`.
 *
 * `draft` erreicht diese Stelle nie — Entwürfe lehnt sendInvoice vorher ab.
 *
 * @returns den neuen Status oder `null`, wenn der Status unverändert bleibt.
 */
export function nextStatusAfterSend(currentStatus: string): 'sent' | null {
  return currentStatus === 'created' ? 'sent' : null
}

export async function sendInvoice(supabase: Db, ctx: ServiceCtx, invoiceId: string, opts: SendOptions = {}): Promise<{ recipientEmail: string }> {
  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('id', invoiceId).eq('company_id', ctx.companyId).single()
  if (error || !invoice) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')

  if (invoice.status === 'draft') {
    throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Entwürfe können nicht versendet werden. Bitte finalisieren Sie die Rechnung zuerst.')
  }

  const { data: company } = await supabase.from('companies').select('*').eq('id', ctx.companyId).single()
  if (!company) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Firma nicht gefunden')

  const customerSnapshot = invoice.buyer_snapshot as unknown as CustomerSnapshot | null
  const emailSettings = ((company as any).email_settings as EmailSettings) || { mode: 'default' }
  const language = (invoice.language as 'de' | 'en') || 'de'

  const recipientEmail = opts.recipientEmail || invoice.recipient_email || customerSnapshot?.email
  if (!recipientEmail) throw new InvoiceServiceError(400, 'VALIDATION_ERROR', 'Empfänger-E-Mail ist erforderlich')

  const subject =
    opts.subject ||
    (customerSnapshot
      ? generateEmailSubject(emailSettings.invoice_email_subject, invoice as any, customerSnapshot as any, language)
      : `Rechnung ${invoice.invoice_number || ''}`)
  const emailBody =
    opts.body ||
    (customerSnapshot ? generateEmailBody(emailSettings.invoice_email_body, invoice as any, customerSnapshot as any, language) : '')

  // From / reply-to / server token (custom domain support).
  const useCustomDomain = emailSettings.mode === 'custom_domain' && emailSettings.domain_verified && !!emailSettings.from_email
  const fromEmail = useCustomDomain ? emailSettings.from_email! : getDefaultFromEmail()
  const fromName = useCustomDomain ? emailSettings.from_name : (company as any).name
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
  const replyTo = resolveReplyTo(invoice, emailSettings)
  // Attachments (PDF required, XML if present); legacy invoice_file_reference fallback.
  const attachments: Array<{ name: string; content: string; contentType: string }> = []
  const downloadErrors: string[] = []
  const pdfUrl = invoice.pdf_url || (invoice as any).invoice_file_reference
  if (pdfUrl) {
    try {
      const buf = await downloadFromS3(pdfUrl)
      attachments.push({ name: `${invoice.invoice_number || 'Rechnung'}.pdf`, content: buf.toString('base64'), contentType: 'application/pdf' })
    } catch (err) {
      downloadErrors.push(`PDF: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
  if (invoice.xml_url) {
    try {
      const buf = await downloadFromS3(invoice.xml_url)
      attachments.push({ name: `${invoice.invoice_number || 'Rechnung'}.xml`, content: buf.toString('base64'), contentType: 'application/xml' })
    } catch (err) {
      downloadErrors.push(`XML: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
  if (attachments.length === 0) {
    throw new InvoiceServiceError(
      400,
      'VALIDATION_ERROR',
      downloadErrors.length > 0
        ? `Fehler beim Laden der Dateien: ${downloadErrors.join(', ')}`
        : 'Keine Dateien zum Anhängen verfügbar. Bitte stellen Sie sicher, dass die Rechnung finalisiert wurde.'
    )
  }

  try {
    await sendEmail({ from, to: recipientEmail, subject, htmlBody: textToHtml(emailBody || ''), textBody: emailBody, replyTo, attachments })
  } catch (err) {
    throw new InvoiceServiceError(500, 'SERVER_ERROR', err instanceof Error ? err.message : 'Fehler beim Versenden der E-Mail')
  }

  // Non-fatal: the email was sent even if the status update fails.
  // Die Empfängeradresse wird immer nachgezogen, der Status nur, wenn der
  // Versand ihn tatsächlich weiterbewegt (siehe nextStatusAfterSend).
  const nextStatus = nextStatusAfterSend(invoice.status)
  const sendUpdate: Record<string, unknown> = { recipient_email: recipientEmail }
  if (nextStatus) sendUpdate.status = nextStatus
  await supabase.from('invoices').update(sendUpdate).eq('id', invoiceId)

  return { recipientEmail }
}

export interface DuplicateResult {
  draft: DBInvoice
  /** Nummer der Vorlage, für die Rückmeldung an den Nutzer. */
  sourceNumber: string | null
}

/** Heute als ISO-Tag in Deutschland — der Server läuft in UTC und läge zwischen 0 und 2 Uhr einen Tag zurück. */
function heuteInBerlin(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())
}

/**
 * Legt aus einer bestehenden Rechnung einen neuen Entwurf an. Die Vorlage bleibt
 * unberührt; was kopiert wird und was nicht, steht in `lib/invoice-duplicate.ts`.
 *
 * Kein Paywall-Check: Entwürfe bleiben frei, bezahlt wird erst beim Finalisieren.
 */
export async function duplicateInvoice(supabase: Db, ctx: ServiceCtx, invoiceId: string): Promise<DuplicateResult> {
  const { data: original, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('company_id', ctx.companyId)
    .single()
  if (error || !original) throw new InvoiceServiceError(404, 'NOT_FOUND', 'Rechnung nicht gefunden')

  const source = original as DBInvoice

  // Die Kontakte frisch laden: Der Snapshot an der Vorlage ist der Stand vom
  // Finalisieren, und eine inzwischen geänderte Adresse soll nicht in den neuen
  // Beleg wandern. Ist der Kontakt gelöscht, bleibt der alte Snapshot stehen.
  const loadContact = async (id: string | null) => {
    if (!id) return null
    const { data } = await supabase.from('contacts').select('*').eq('id', id).eq('company_id', ctx.companyId).maybeSingle()
    return (data as Contact | null) ?? null
  }
  const [buyerContact, sellerContact] = await Promise.all([
    source.buyer_is_self ? null : loadContact(source.buyer_contact_id),
    source.seller_is_self ? null : loadContact(source.seller_contact_id),
  ])

  let insert
  try {
    insert = buildDuplicateDraft(source, { today: heuteInBerlin(), buyerContact, sellerContact })
  } catch (err) {
    if (err instanceof DuplicateNotAllowedError) throw new InvoiceServiceError(400, 'VALIDATION_ERROR', err.message)
    throw err
  }

  const { data: draft, error: insErr } = await supabase.from('invoices').insert(insert).select().single()
  if (insErr || !draft) throw new InvoiceServiceError(500, 'SERVER_ERROR', 'Entwurf konnte nicht angelegt werden')

  return { draft: draft as DBInvoice, sourceNumber: source.invoice_number }
}
