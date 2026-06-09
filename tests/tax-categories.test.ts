import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAndParse, makeInvoice } from "./helpers";
import { generateXRechnungXML } from "../lib/zugferd-generator";
import { validateXRechnungInvoice } from "../lib/schema";
import type { Invoice } from "../lib/schema";

/**
 * EN 16931 VAT category handling (P2): exempt (§4 / category E), reverse charge
 * (§13b / category AE), and mixed invoices. These mirror the rules the KoSIT
 * validator enforces (BR-E-*, BR-AE-*) for the codes node-zugferd emits.
 */

const exemptItem = {
  description: "Heilbehandlung",
  quantity: 1,
  unit: "Stk",
  unitPrice: 200,
  vatRate: 0,
  taxCategory: "E" as const,
  exemptionReason: "Steuerfrei gemäß § 4 Nr. 14 UStG",
};

test("category E: zero VAT, breakdown carries the exemption reason", async () => {
  const { taxes, summation } = await generateAndParse(makeInvoice({ items: [exemptItem] }));
  assert.equal(taxes.length, 1);
  assert.equal(taxes[0].category, "E");
  assert.equal(taxes[0].rate, 0);
  assert.equal(taxes[0].calculated, 0, "exempt VAT amount must be 0");
  assert.equal(taxes[0].exemptionReason, exemptItem.exemptionReason);
  assert.equal(summation.taxTotal, 0);
  assert.equal(summation.grandTotal, summation.taxBasisTotal); // no VAT added
});

test("mixed S + E: two breakdowns, only the standard line is taxed", async () => {
  const inv = makeInvoice({
    items: [
      { description: "Beratung", quantity: 2, unit: "HUR", unitPrice: 100, vatRate: 19, taxCategory: "S" },
      exemptItem,
    ],
  });
  const { taxes, summation } = await generateAndParse(inv);
  const byCat = Object.fromEntries(taxes.map((t) => [t.category, t]));
  assert.ok(byCat.S && byCat.E, "both S and E breakdowns must be present");
  assert.equal(byCat.S.calculated, 38, "19% of 200 = 38");
  assert.equal(byCat.E.calculated, 0);
  assert.equal(summation.taxTotal, 38);
  assert.equal(summation.taxBasisTotal, 400); // 200 standard + 200 exempt
});

test("category AE: reverse charge carries buyer VAT id and exemption reason", async () => {
  const inv = makeInvoice({
    customer: {
      name: "Bau AG",
      address: { street: "Baustr", streetNumber: "5", postalCode: "80331", city: "München", country: "DE" },
      additionalInfo: ["bau@bau.de"],
      vatId: "DE987654321",
    },
    items: [
      { description: "Bauleistung", quantity: 1, unit: "Stk", unitPrice: 5000, vatRate: 0, taxCategory: "AE", exemptionReason: "§ 13b UStG" },
    ],
  });
  const { taxes, buyerVatId } = await generateAndParse(inv);
  assert.equal(taxes[0].category, "AE");
  assert.equal(taxes[0].calculated, 0);
  assert.equal(buyerVatId, "DE987654321");
});

test("cancellation invoice references the original (BG-3 / BR-DE-26)", async () => {
  const inv = makeInvoice({
    invoiceNumber: "ST-2026-001",
    items: [{ description: "Beratung", quantity: -1, unit: "Stk", unitPrice: 100, vatRate: 19 }],
  });
  const xml = await generateXRechnungXML(inv, { isCancellation: true, originalInvoiceNumber: "RE-2026-001" });
  assert.match(xml, /<ram:TypeCode>384<\/ram:TypeCode>/, "must use corrected-invoice type code 384");
  assert.match(xml, /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-001<\/ram:IssuerAssignedID>/);
});

test("validation rejects an exempt line without an exemption reason", () => {
  const inv: Invoice = makeInvoice({
    items: [{ description: "Heilbehandlung", quantity: 1, unit: "Stk", unitPrice: 200, vatRate: 0, taxCategory: "E" }],
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("BT-120")), res.errors.join("; "));
});

test("validation rejects category E with a non-zero rate", () => {
  const inv = makeInvoice({
    items: [{ description: "x", quantity: 1, unit: "Stk", unitPrice: 200, vatRate: 19, taxCategory: "E", exemptionReason: "§4" }],
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("0%")), res.errors.join("; "));
});

test("validation rejects category S with a zero rate", () => {
  const inv = makeInvoice({
    items: [{ description: "x", quantity: 1, unit: "Stk", unitPrice: 200, vatRate: 0, taxCategory: "S" }],
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
});

test("validation rejects reverse charge without a buyer VAT id", () => {
  const inv = makeInvoice({
    customer: {
      name: "Bau AG",
      address: { street: "Baustr", streetNumber: "5", postalCode: "80331", city: "München", country: "DE" },
      additionalInfo: ["bau@bau.de"],
      // no vatId
    },
    items: [{ description: "Bau", quantity: 1, unit: "Stk", unitPrice: 5000, vatRate: 0, taxCategory: "AE", exemptionReason: "§13b" }],
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("AE") || e.includes("13b")), res.errors.join("; "));
});
