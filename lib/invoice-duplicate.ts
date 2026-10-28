import type { Invoice, InvoiceInsert, Contact, PartySnapshot, LineItem, Address } from '@/types'
import { addDays, daysBetween } from './iso-day'

/**
 * Eine Rechnung als neuen Entwurf kopieren.
 *
 * Reine Funktion: kein Netz, keine Datenbank, kein „heute" — den Tag reicht der
 * Aufrufer herein, so wie bei `iso-day.ts`.
 *
 * **Was mitkommt:** Positionen, Empfänger und Aussteller, Sprache, Referenz.
 * Das ist der Inhalt, den man nicht noch einmal tippen will.
 *
 * **Was nicht mitkommt:** alles, was die Rechnung zum Beleg gemacht hat —
 * Nummer, Dateien, Finalisierung, Storno-Bezug. Ebenso Einleitungs- und
 * Schlusstext: Sie sind nirgends pro Rechnung editierbar, an einer
 * finalisierten Rechnung also nur der beim Finalisieren eingefrorene
 * Firmenstandard. Die Kopie soll den heutigen bekommen.
 *
 * Auch die Empfänger-E-Mail bleibt zurück. Sie steht an der Rechnung entweder
 * als bewusste Überschreibung oder als beim Finalisieren aus dem Empfänger
 * übernommener Wert; eine alte Adresse würde die neue Rechnung an den Stand von
 * vor Monaten schicken (vgl. #38). Ohne sie leitet `finalizeInvoice` sie wieder
 * aus dem Empfänger ab.
 *
 * **Daten:** Rechnungsdatum und Leistungsdatum werden heute — das Leistungsdatum
 * der alten Rechnung wäre für die neue schlicht falsch (§ 14 UStG). Das
 * Zahlungsziel bleibt in Tagen erhalten: 14 Tage Frist bleiben 14 Tage.
 */

/** Frist, wenn die Vorlage keine verwertbare hat. Wie im Entwurfs-Drawer. */
const STANDARD_ZAHLUNGSZIEL_TAGE = 30

/** Kontakt → Snapshot, in der Form, in der ihn der Entwurfseditor ablegt. */
export function partySnapshotFromContact(contact: Contact): PartySnapshot {
  const bank = contact.bank_details as { bank_name?: string; iban?: string; bic?: string } | null
  return {
    id: contact.id,
    name: contact.name,
    // Der ganze Block, nicht nur die vier bekannten Felder: Sonst fällt die
    // Adresszusatzzeile stillschweigend heraus (vgl. #39).
    address: { street: '', streetnumber: '', city: '', zip: '', country: 'DE', ...(contact.address as Partial<Address> | null) },
    email: contact.email || undefined,
    vat_id: contact.vat_id || undefined,
    invoice_number_prefix: contact.invoice_number_prefix || undefined,
    tax_id: contact.tax_id || undefined,
    bank_details: bank ? { bank_name: bank.bank_name, iban: bank.iban, bic: bank.bic } : undefined,
    contact:
      contact.contact_name || contact.contact_phone || contact.contact_email
        ? {
            name: contact.contact_name || undefined,
            phone: contact.contact_phone || undefined,
            email: contact.contact_email || undefined,
          }
        : undefined,
    court: contact.court || undefined,
    register_number: contact.register_number || undefined,
    managing_director: contact.managing_director || undefined,
  }
}

/**
 * Zahlungsziel der Vorlage in Tagen — oder das Standardziel, wenn eines der
 * Daten fehlt, kaputt ist oder die Frist negativ wäre.
 */
export function zahlungszielTage(rechnungsdatum: string | null, faelligkeit: string | null): number {
  if (!rechnungsdatum || !faelligkeit) return STANDARD_ZAHLUNGSZIEL_TAGE
  try {
    const tage = daysBetween(rechnungsdatum, faelligkeit)
    return tage >= 0 ? tage : STANDARD_ZAHLUNGSZIEL_TAGE
  } catch {
    return STANDARD_ZAHLUNGSZIEL_TAGE
  }
}

export interface DuplicateContext {
  /** Heute als ISO-Tag (Europe/Berlin), vom Aufrufer. */
  today: string
  /** Aktueller Stand des Empfänger-Kontakts, falls die Vorlage einen hat und er noch existiert. */
  buyerContact?: Contact | null
  /** Dasselbe für einen externen Aussteller. */
  sellerContact?: Contact | null
  /** Für neue Positions-IDs — in Tests festnagelbar. */
  newId?: () => string
}

export class DuplicateNotAllowedError extends Error {}

export function buildDuplicateDraft(original: Invoice, ctx: DuplicateContext): InvoiceInsert {
  // Eine Stornorechnung hat negierte Positionen und gehört zu genau einer
  // Rechnung — als Vorlage für etwas Neues taugt sie nicht.
  if (original.invoice_type === 'cancellation') {
    throw new DuplicateNotAllowedError('Eine Stornorechnung kann nicht dupliziert werden.')
  }

  const newId = ctx.newId ?? (() => crypto.randomUUID())
  const lineItems = ((original.line_items as unknown as LineItem[]) || []).map((item) => ({ ...item, id: newId() }))

  // Wie der Editor: Ist die Seite die eigene Firma, steht im Entwurf kein
  // Snapshot — den baut `finalizeInvoice` aus den dann aktuellen Firmendaten.
  const sellerIsSelf = original.seller_is_self
  const buyerIsSelf = original.buyer_is_self

  const sellerSnapshot = sellerIsSelf
    ? null
    : ctx.sellerContact
      ? partySnapshotFromContact(ctx.sellerContact)
      : original.seller_snapshot
  const buyerSnapshot = buyerIsSelf
    ? null
    : ctx.buyerContact
      ? partySnapshotFromContact(ctx.buyerContact)
      : original.buyer_snapshot

  return {
    company_id: original.company_id,
    // Die Kopie bleibt in der Abteilung der Vorlage; sonst landete sie über den
    // Standard-Trigger in „Allgemein“, wo ein Mitglied evtl. gar nicht schreiben darf.
    department_id: original.department_id,
    status: 'draft',
    invoice_type: 'invoice',
    invoice_number: null,
    invoice_date: ctx.today,
    due_date: addDays(ctx.today, zahlungszielTage(original.invoice_date, original.due_date)),
    service_date: ctx.today,
    seller_is_self: sellerIsSelf,
    seller_contact_id: sellerIsSelf ? null : original.seller_contact_id,
    seller_snapshot: sellerSnapshot as InvoiceInsert['seller_snapshot'],
    buyer_is_self: buyerIsSelf,
    buyer_contact_id: buyerIsSelf ? null : original.buyer_contact_id,
    buyer_snapshot: buyerSnapshot as InvoiceInsert['buyer_snapshot'],
    contact_person_id: sellerIsSelf ? original.contact_person_id : null,
    line_items: lineItems as unknown as InvoiceInsert['line_items'],
    subtotal: original.subtotal,
    vat_amount: original.vat_amount,
    total_amount: original.total_amount,
    language: original.language,
    buyer_reference: original.buyer_reference,
  }
}
