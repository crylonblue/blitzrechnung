import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInvoiceTotals } from "../lib/invoice-totals";

/**
 * Direct unit tests for the shared EN 16931 calculator that the XML generator,
 * the PDF generator and the draft API routes all depend on.
 */

test("round-then-sum keeps BR-CO-14 consistent across two rates", () => {
  const t = computeInvoiceTotals([
    { quantity: 3, unitPrice: 99.99, vatRate: 19 },
    { quantity: 7, unitPrice: 0.07, vatRate: 7 },
  ]);
  // Sum of category VAT amounts must equal the total VAT.
  const sumCat = t.vatBreakdown.reduce((s, g) => s + g.taxAmount, 0);
  assert.equal(t.taxAmount, Math.round(sumCat * 100) / 100);
  assert.equal(t.taxAmount, 57.02); // 56.99 + 0.03, not 57.03
});

test("line nets derive from the 4-decimal unit price", () => {
  const t = computeInvoiceTotals([{ quantity: 1234, unitPrice: 0.0719, vatRate: 19 }]);
  assert.equal(t.lineNets[0], 88.72);
  assert.equal(t.netTotal, 88.72);
});

test("mixed S + E produces two breakdowns; only S is taxed", () => {
  const t = computeInvoiceTotals([
    { quantity: 2, unitPrice: 100, vatRate: 19, taxCategory: "S" },
    { quantity: 1, unitPrice: 200, vatRate: 0, taxCategory: "E", exemptionReason: "§ 4 Nr. 14 UStG" },
  ]);
  assert.equal(t.vatBreakdown.length, 2);
  const e = t.vatBreakdown.find((g) => g.category === "E")!;
  const s = t.vatBreakdown.find((g) => g.category === "S")!;
  assert.equal(s.taxAmount, 38);
  assert.equal(e.taxAmount, 0);
  assert.equal(e.exemptionReason, "§ 4 Nr. 14 UStG");
  assert.equal(t.netTotal, 400);
  assert.equal(t.taxAmount, 38);
  assert.equal(t.grossTotal, 438);
});

test("implied category: rate 0 → Z, rate > 0 → S", () => {
  const t = computeInvoiceTotals([
    { quantity: 1, unitPrice: 100, vatRate: 19 },
    { quantity: 1, unitPrice: 50, vatRate: 0 },
  ]);
  assert.deepEqual(
    t.vatBreakdown.map((g) => g.category).sort(),
    ["S", "Z"]
  );
});
