import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateInvoice, InvoiceServiceError } from "../lib/invoice-service";

/**
 * duplicateInvoice gegen einen Stub-Client: Was fragt der Service ab, und was
 * schreibt er? Die Datenbank selbst (RLS, CHECK-Constraints) ist damit nicht
 * erfasst — die Payload ist aber so gebaut, dass sie die Constraints aus
 * migrations/020 erfüllt, solange es die Vorlage tut.
 */

type Row = Record<string, unknown>;

interface Aufruf {
  table: string;
  filters: Array<[string, unknown]>;
  insert?: Row;
}

/** Minimaler Query-Builder: merkt sich Filter und Insert, liefert konfigurierte Zeilen. */
function stub(tabellen: Record<string, Row | null>) {
  const aufrufe: Aufruf[] = [];
  const client = {
    from(table: string) {
      const a: Aufruf = { table, filters: [] };
      aufrufe.push(a);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => (a.filters.push([k, v]), b),
        insert: (row: Row) => ((a.insert = row), b),
        single: async () => {
          if (a.insert) return { data: { id: "neu", ...a.insert }, error: null };
          const row = tabellen[table] ?? null;
          return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
        },
        maybeSingle: async () => ({ data: tabellen[table] ?? null, error: null }),
      };
      return b;
    },
  };
  return { client: client as never, aufrufe };
}

const vorlage = {
  id: "alt",
  company_id: "firma-1",
  status: "sent",
  invoice_type: "invoice",
  invoice_number: "RE-1",
  invoice_date: "2026-10-01",
  due_date: "2026-10-15",
  seller_is_self: true,
  seller_contact_id: null,
  buyer_is_self: false,
  buyer_contact_id: "kontakt-1",
  buyer_snapshot: { name: "Alt", address: {} },
  line_items: [{ id: "p1", description: "x", quantity: 1, unit: "piece", unit_price: 1, vat_rate: 19, total: 1 }],
  subtotal: 1,
  vat_amount: 0.19,
  total_amount: 1.19,
  language: "de",
};
const ctx = { companyId: "firma-1", userId: "u1" };

test("legt einen Entwurf an und liefert Nummer der Vorlage zurück", async () => {
  const { client, aufrufe } = stub({
    invoices: vorlage,
    contacts: { id: "kontakt-1", name: "Aktuell GmbH", address: { street: "S", streetnumber: "1", city: "Bonn", zip: "53111", country: "DE" } },
  });
  const r = await duplicateInvoice(client, ctx, "alt");
  assert.equal(r.sourceNumber, "RE-1");
  const insert = aufrufe.find((a) => a.insert)!;
  assert.equal(insert.table, "invoices");
  assert.equal(insert.insert!.status, "draft");
  assert.equal(insert.insert!.invoice_number, null);
  assert.equal((insert.insert!.buyer_snapshot as { name: string }).name, "Aktuell GmbH");
});

test("Vorlage und Kontakt werden nur innerhalb der eigenen Firma gelesen", async () => {
  const { client, aufrufe } = stub({ invoices: vorlage, contacts: null });
  await duplicateInvoice(client, ctx, "alt");
  for (const a of aufrufe.filter((x) => !x.insert)) {
    assert.deepEqual(a.filters.find(([k]) => k === "company_id"), ["company_id", "firma-1"], `${a.table} ohne Firmenfilter`);
  }
});

test("unbekannte Rechnung: 404", async () => {
  const { client } = stub({ invoices: null });
  await assert.rejects(duplicateInvoice(client, ctx, "x"), (e) => e instanceof InvoiceServiceError && e.status === 404);
});

test("Stornorechnung: 400, und es wird nichts geschrieben", async () => {
  const { client, aufrufe } = stub({ invoices: { ...vorlage, invoice_type: "cancellation" } });
  await assert.rejects(duplicateInvoice(client, ctx, "alt"), (e) => e instanceof InvoiceServiceError && e.status === 400);
  assert.equal(aufrufe.some((a) => a.insert), false);
});

test("eigene Firma als Empfänger: der Empfänger wird nicht als Kontakt nachgeschlagen", async () => {
  // Zulässige Kombination (chk_not_self_to_self): externer Aussteller, Empfänger = eigene Firma.
  const { client, aufrufe } = stub({
    invoices: { ...vorlage, buyer_is_self: true, buyer_contact_id: null, seller_is_self: false, seller_contact_id: "kontakt-9" },
    contacts: { id: "kontakt-9", name: "Fremdfirma", address: {} },
  });
  await duplicateInvoice(client, ctx, "alt");
  const kontaktIds = aufrufe.filter((a) => a.table === "contacts").flatMap((a) => a.filters.filter(([k]) => k === "id").map(([, v]) => v));
  assert.deepEqual(kontaktIds, ["kontakt-9"]);
});
