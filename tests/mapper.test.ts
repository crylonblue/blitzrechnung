import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDBInvoiceToPDFInvoice } from "../lib/invoice-mapper";

/**
 * The mapper must surface the stored service_date (Leistungsdatum, BT-72) and
 * only fall back to the invoice date when no service date was set.
 */

const seller: any = {
  name: "Muster GmbH",
  address: { street: "Hauptstr", streetnumber: "1", zip: "10707", city: "Berlin", country: "DE" },
  email: "info@muster.de",
  bank_details: { iban: "DE89370400440532013000", bank_name: "Test Bank" },
};
const buyer: any = {
  name: "Kunde AG",
  address: { street: "Kundenweg", streetnumber: "2", zip: "20095", city: "Hamburg", country: "DE" },
  email: "kunde@kunde.de",
};
const baseInvoice = (over: Record<string, unknown>): any => ({
  invoice_number: "RE-1",
  invoice_date: "2026-06-08",
  line_items: [{ description: "x", quantity: 1, unit: "Stk", unit_price: 10, vat_rate: 19 }],
  ...over,
});

test("mapper uses stored service_date", () => {
  const pdf = mapDBInvoiceToPDFInvoice(baseInvoice({ service_date: "2026-05-31" }), seller, buyer);
  assert.equal(pdf.serviceDate, "2026-05-31");
});

test("mapper falls back to invoice_date when service_date is null", () => {
  const pdf = mapDBInvoiceToPDFInvoice(baseInvoice({ service_date: null }), seller, buyer);
  assert.equal(pdf.serviceDate, "2026-06-08");
});

test("mapper passes due_date through to dueDate", () => {
  const pdf = mapDBInvoiceToPDFInvoice(baseInvoice({ due_date: "2026-07-15" }), seller, buyer);
  assert.equal(pdf.dueDate, "2026-07-15");
});
