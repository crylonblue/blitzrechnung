import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDuplicateDraft,
  DuplicateNotAllowedError,
  partySnapshotFromContact,
  zahlungszielTage,
} from "../lib/invoice-duplicate";
import type { Contact, Invoice } from "../types";

/**
 * Rechnung duplizieren.
 *
 * Der Kunde bucht monatlich dieselbe Leistung und will nicht jedes Mal alles
 * neu eintippen. Die Kopie ist ein Entwurf — und ein Entwurf darf nichts von
 * dem mitschleppen, was die Vorlage zum Beleg gemacht hat.
 */

const HEUTE = "2026-11-03";

let zaehler = 0;
const neueId = () => `neu-${++zaehler}`;

function rechnung(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "alt",
    company_id: "firma-1",
    status: "paid",
    invoice_type: "invoice",
    invoice_number: "RE-2026-0042",
    invoice_date: "2026-10-01",
    due_date: "2026-10-15",
    service_date: "2026-09-30",
    seller_is_self: true,
    seller_contact_id: null,
    seller_snapshot: { name: "Meine Firma", address: {} },
    buyer_is_self: false,
    buyer_contact_id: "kontakt-1",
    buyer_snapshot: {
      id: "kontakt-1",
      name: "Kunde GmbH",
      address: { street: "Alte Str.", streetnumber: "1", city: "Köln", zip: "50667", country: "DE" },
      email: "alt@kunde.de",
    },
    line_items: [
      { id: "p1", description: "Betreuung", quantity: 1, unit: "piece", unit_price: 500, vat_rate: 19, total: 500, vat_amount: 95 },
      { id: "p2", description: "Hosting", quantity: 1, unit: "piece", unit_price: 50, vat_rate: 19, total: 50, vat_amount: 9.5 },
    ],
    subtotal: 550,
    vat_amount: 104.5,
    total_amount: 654.5,
    invoice_file_reference: "ref",
    pdf_url: "s3://alt.pdf",
    xml_url: "s3://alt.xml",
    recipient_email: "alt@kunde.de",
    language: "en",
    intro_text: "eingefrorener Standardtext",
    outro_text: "eingefrorener Schlusstext",
    buyer_reference: "04011000-12345-34",
    contact_person_id: "person-1",
    cancelled_invoice_id: null,
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    finalized_at: "2026-10-01T08:05:00Z",
    ...over,
  } as Invoice;
}

function kontakt(over: Partial<Contact> = {}): Contact {
  return {
    id: "kontakt-1",
    company_id: "firma-1",
    name: "Kunde GmbH",
    address: { street: "Neue Str.", streetnumber: "7", addressline2: "Hinterhaus", city: "Bonn", zip: "53111", country: "DE" },
    email: "neu@kunde.de",
    vat_id: "DE123",
    invoice_number_prefix: null,
    tax_id: null,
    bank_details: null,
    court: null,
    register_number: null,
    managing_director: null,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    ...over,
  } as Contact;
}

const bauen = (o: Invoice, extra: Parameters<typeof buildDuplicateDraft>[1] extends infer C ? Partial<C> : never = {}) =>
  buildDuplicateDraft(o, { today: HEUTE, newId: neueId, ...extra });

test("die Kopie ist ein Entwurf ohne Nummer, Dateien und Finalisierung", () => {
  const d = bauen(rechnung());
  assert.equal(d.status, "draft");
  assert.equal(d.invoice_type, "invoice");
  assert.equal(d.invoice_number, null);
  for (const feld of ["pdf_url", "xml_url", "finalized_at", "cancelled_invoice_id", "invoice_file_reference", "id", "created_at"]) {
    assert.equal((d as Record<string, unknown>)[feld], undefined, `${feld} darf nicht mitkommen`);
  }
});

test("Rechnungs- und Leistungsdatum sind heute, nicht die der Vorlage", () => {
  const d = bauen(rechnung());
  assert.equal(d.invoice_date, HEUTE);
  assert.equal(d.service_date, HEUTE);
});

test("das Zahlungsziel bleibt in Tagen erhalten", () => {
  // Vorlage: 1.10. → 15.10. = 14 Tage. Kopie: 3.11. + 14 = 17.11.
  assert.equal(bauen(rechnung()).due_date, "2026-11-17");
});

test("Zahlungsziel über einen Monatswechsel und ein Schaltjahr", () => {
  const d = buildDuplicateDraft(rechnung({ invoice_date: "2028-01-01", due_date: "2028-01-31" }), { today: "2028-02-10", newId: neueId });
  assert.equal(d.due_date, "2028-03-11"); // 30 Tage ab 10.2.2028 (Schaltjahr: 29 Tage Februar)
});

test("fehlt oder kippt das Zahlungsziel der Vorlage, gilt der Standard von 30 Tagen", () => {
  assert.equal(zahlungszielTage(null, "2026-10-15"), 30);
  assert.equal(zahlungszielTage("2026-10-01", null), 30);
  assert.equal(zahlungszielTage("kaputt", "2026-10-15"), 30);
  // Fälligkeit vor dem Rechnungsdatum — eine negative Frist wird nicht vererbt.
  assert.equal(zahlungszielTage("2026-10-15", "2026-10-01"), 30);
  // Sofort fällig ist ein gültiges Ziel und bleibt es.
  assert.equal(zahlungszielTage("2026-10-01", "2026-10-01"), 0);
});

test("Positionen und Summen kommen mit, die Positionen mit neuen IDs", () => {
  const o = rechnung();
  const d = bauen(o);
  const items = d.line_items as unknown as Array<{ id: string; description: string; unit_price: number }>;
  assert.deepEqual(items.map((i) => i.description), ["Betreuung", "Hosting"]);
  assert.deepEqual(items.map((i) => i.unit_price), [500, 50]);
  assert.equal(new Set(items.map((i) => i.id)).size, 2);
  assert.ok(items.every((i) => i.id.startsWith("neu-")), "IDs der Vorlage dürfen nicht weiterleben");
  assert.equal(d.subtotal, 550);
  assert.equal(d.vat_amount, 104.5);
  assert.equal(d.total_amount, 654.5);
  // Die Vorlage selbst bleibt unangetastet.
  assert.equal((o.line_items as unknown as Array<{ id: string }>)[0].id, "p1");
});

test("Sprache, Referenz und Ansprechpartner kommen mit", () => {
  const d = bauen(rechnung());
  assert.equal(d.language, "en");
  assert.equal(d.buyer_reference, "04011000-12345-34");
  assert.equal(d.contact_person_id, "person-1");
});

test("Empfänger-E-Mail und eingefrorene Texte bleiben zurück", () => {
  const d = bauen(rechnung());
  assert.equal((d as Record<string, unknown>).recipient_email, undefined);
  assert.equal((d as Record<string, unknown>).intro_text, undefined);
  assert.equal((d as Record<string, unknown>).outro_text, undefined);
});

test("der Empfänger kommt im aktuellen Stand des Kontakts, nicht im alten Snapshot", () => {
  const d = bauen(rechnung(), { buyerContact: kontakt() });
  const snap = d.buyer_snapshot as { address: Record<string, string>; email: string };
  assert.equal(snap.address.city, "Bonn");
  assert.equal(snap.email, "neu@kunde.de");
  assert.equal(d.buyer_contact_id, "kontakt-1");
});

test("die Adresszusatzzeile geht beim Auffrischen nicht verloren", () => {
  const snap = partySnapshotFromContact(kontakt());
  assert.equal(snap.address.addressline2, "Hinterhaus");
});

test("ist der Kontakt inzwischen gelöscht, bleibt der alte Snapshot stehen", () => {
  const o = rechnung();
  const d = bauen(o, { buyerContact: null });
  assert.deepEqual(d.buyer_snapshot, o.buyer_snapshot);
  assert.equal(d.buyer_contact_id, "kontakt-1");
});

test("eigene Firma als Aussteller: kein Snapshot, den baut das Finalisieren", () => {
  const d = bauen(rechnung());
  assert.equal(d.seller_is_self, true);
  assert.equal(d.seller_snapshot, null);
  assert.equal(d.seller_contact_id, null);
});

test("externer Aussteller wird wie der Empfänger aufgefrischt, der Ansprechpartner entfällt", () => {
  const o = rechnung({ seller_is_self: false, seller_contact_id: "kontakt-9", seller_snapshot: { name: "Alt", address: {} } as never });
  const d = bauen(o, { sellerContact: kontakt({ id: "kontakt-9", name: "Fremdfirma" }) });
  assert.equal(d.seller_is_self, false);
  assert.equal(d.seller_contact_id, "kontakt-9");
  assert.equal((d.seller_snapshot as { name: string }).name, "Fremdfirma");
  assert.equal(d.contact_person_id, null);
});

test("Empfänger = eigene Firma: kein Snapshot und keine Kontakt-ID (CHECK-Constraint)", () => {
  const d = bauen(rechnung({ buyer_is_self: true, buyer_contact_id: null, buyer_snapshot: { name: "x", address: {} } as never, seller_is_self: false, seller_contact_id: "kontakt-9" }));
  assert.equal(d.buyer_is_self, true);
  assert.equal(d.buyer_snapshot, null);
  assert.equal(d.buyer_contact_id, null);
});

test("jeder Status außer Storno ist duplizierbar — auch stornierte und Entwürfe", () => {
  for (const status of ["draft", "created", "sent", "reminded", "paid", "cancelled", "uneinbringlich"] as const) {
    assert.equal(bauen(rechnung({ status })).status, "draft", status);
  }
});

test("eine Stornorechnung lässt sich nicht duplizieren", () => {
  assert.throws(() => bauen(rechnung({ invoice_type: "cancellation" })), DuplicateNotAllowedError);
});
