import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAndParse, makeInvoice, round2, toCiiDate } from "./helpers";

/**
 * EN 16931 / XRechnung correctness checks against the XML emitted by
 * generateXRechnungXML(). These encode the specific calculation and content
 * rules that the official KoSIT validator enforces and that our P0 fixes target.
 */

// ── BR-CO-10: Σ line net amounts (BT-131) == document line total (BT-106) ──
test("BR-CO-10: header line total equals sum of line net amounts", async () => {
  // 3-decimal unit prices expose 'sum-then-round' vs 'round-then-sum' drift.
  const inv = makeInvoice({
    items: [
      { description: "A", quantity: 3, unit: "Stk", unitPrice: 9.999, vatRate: 19 },
      { description: "B", quantity: 3, unit: "Stk", unitPrice: 9.999, vatRate: 19 },
    ],
  });
  const { lines, summation } = await generateAndParse(inv);
  const sumOfLines = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  assert.equal(
    summation.lineTotal,
    sumOfLines,
    `BT-106 (${summation.lineTotal}) must equal Σ BT-131 (${sumOfLines})`
  );
});

// ── BR-CO-14: VAT total (BT-110) == Σ category VAT amounts (BT-117) ──
test("BR-CO-14: tax total equals sum of VAT category amounts", async () => {
  // Two VAT rates — the classic case where rounding the grand sum diverges
  // from the sum of per-category rounded amounts.
  const inv = makeInvoice({
    items: [
      { description: "A", quantity: 3, unit: "Stk", unitPrice: 99.99, vatRate: 19 },
      { description: "B", quantity: 7, unit: "Stk", unitPrice: 0.07, vatRate: 7 },
    ],
  });
  const { taxes, summation } = await generateAndParse(inv);
  const sumOfCategories = round2(taxes.reduce((s, t) => s + t.calculated, 0));
  assert.equal(
    summation.taxTotal,
    sumOfCategories,
    `BT-110 (${summation.taxTotal}) must equal Σ BT-117 (${sumOfCategories})`
  );
});

// ── BR-CO-17 / BR-S-08: per category, VAT amount == base × rate (2dp) ──
test("BR-CO-17: each VAT category amount equals basis × rate", async () => {
  const inv = makeInvoice({
    items: [
      { description: "A", quantity: 3, unit: "Stk", unitPrice: 99.99, vatRate: 19 },
      { description: "B", quantity: 7, unit: "Stk", unitPrice: 0.07, vatRate: 7 },
    ],
  });
  const { taxes } = await generateAndParse(inv);
  for (const t of taxes) {
    assert.equal(
      t.calculated,
      round2((t.basis * t.rate) / 100),
      `category ${t.rate}%: BT-117 (${t.calculated}) must equal base ${t.basis} × ${t.rate}%`
    );
  }
});

// ── BR-CO-15: grand total == taxable base total + VAT total ──
test("BR-CO-15: grand total equals taxable base + VAT total", async () => {
  const inv = makeInvoice({
    items: [
      { description: "A", quantity: 3, unit: "Stk", unitPrice: 99.99, vatRate: 19 },
      { description: "B", quantity: 7, unit: "Stk", unitPrice: 0.07, vatRate: 7 },
    ],
  });
  const { summation } = await generateAndParse(inv);
  assert.equal(
    summation.grandTotal,
    round2(summation.taxBasisTotal + summation.taxTotal)
  );
});

// ── BT-146: item net price must be the UNIT price, not the line total ──
test("BT-146: net price is the unit price with base quantity 1", async () => {
  const inv = makeInvoice({
    items: [{ description: "A", quantity: 3, unit: "Stk", unitPrice: 99.99, vatRate: 19 }],
  });
  const { lines } = await generateAndParse(inv);
  assert.equal(lines[0].netPrice, 99.99, "BT-146 must equal the unit price");
  assert.equal(lines[0].basisQuantity, 1, "BT-149 base quantity should be 1");
  assert.equal(lines[0].billedQuantity, 3, "BT-129 billed quantity should be 3");
  // Sanity: (price / base) × billed == line net amount
  assert.equal(lines[0].lineTotal, round2((99.99 / 1) * 3));
});

// ── BT-72: actual delivery / service date must be present in the XML ──
test("BT-72: service date is written to the header delivery", async () => {
  const inv = makeInvoice({ invoiceDate: "2026-06-08", serviceDate: "2026-05-31" });
  const { deliveryDate } = await generateAndParse(inv);
  assert.equal(
    deliveryDate,
    toCiiDate("2026-05-31"),
    "BT-72 ActualDeliverySupplyChainEvent/OccurrenceDateTime must equal the service date"
  );
});

// ── Line net amount must equal quantity × (net price ÷ base quantity) ──
// (KoSIT rejects otherwise; broke for >2-decimal unit prices when BT-146 was
// rounded to 2 decimals.)
test("line net amount is consistent with unit price for fractional prices", async () => {
  const inv = makeInvoice({
    items: [{ description: "Strom kWh", quantity: 1234, unit: "KWH", unitPrice: 0.0719, vatRate: 19 }],
  });
  const { lines } = await generateAndParse(inv);
  const l = lines[0];
  assert.equal(l.lineTotal, round2(l.billedQuantity * (l.netPrice / l.basisQuantity)));
});

// ── BT-9: payment due date must reflect the agreed due date, not a fixed +14 ──
test("BT-9: due date uses the provided dueDate", async () => {
  const inv = makeInvoice({ invoiceDate: "2026-06-08", dueDate: "2026-07-15" });
  const { dueDate } = await generateAndParse(inv);
  assert.equal(dueDate, toCiiDate("2026-07-15"));
});

test("BT-9: due date falls back to invoice date + 14 days when unset", async () => {
  const inv = makeInvoice({ invoiceDate: "2026-06-08", dueDate: undefined });
  const { dueDate } = await generateAndParse(inv);
  assert.equal(dueDate, toCiiDate("2026-06-22"));
});
