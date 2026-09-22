import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateInvoicePDF } from "../lib/pdf-generator";
import { makeInvoice } from "./helpers";
import type { InvoiceItem } from "../lib/schema";

/**
 * Page breaks in the invoice PDF.
 *
 * The generator used to emit exactly one page whatever it was given, so a long
 * invoice drew its totals over the footer and, past roughly 25 positions, off
 * the page entirely — silently, since pdf-lib happily draws at a negative y.
 * These tests pin the invariant that content grows onto further pages instead.
 */

const items = (n: number, description = "Leistung"): InvoiceItem[] =>
  Array.from({ length: n }, (_, i) => ({
    description: `Pos. ${i + 1} ${description}`,
    quantity: 1,
    unit: "Stk",
    unitPrice: 100,
    vatRate: 19,
  }));

const pageCount = async (n: number, description?: string): Promise<number> => {
  const pdf = await generateInvoicePDF(makeInvoice({ items: items(n, description) }), "de");
  return (await PDFDocument.load(pdf)).getPageCount();
};

test("a short invoice still fits on a single page", async () => {
  assert.equal(await pageCount(1), 1);
  assert.equal(await pageCount(5), 1);
});

test("a long invoice flows onto further pages", async () => {
  assert.ok((await pageCount(40)) >= 2, "40 positions must not be squeezed onto one page");
  assert.ok((await pageCount(200)) >= 8, "200 positions need a good many pages");
});

test("page count grows monotonically with the number of positions", async () => {
  const counts = await Promise.all([1, 20, 60, 120].map((n) => pageCount(n)));
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1], `page count dropped: ${counts.join(" -> ")}`);
  }
});

test("long descriptions consume pages rather than overflowing one", async () => {
  const long = "sehr ausführliche Leistungsbeschreibung ".repeat(8);
  assert.ok((await pageCount(20, long)) >= 3);
});

test("every page carries content: no runaway blank pages", async () => {
  // One row is ~20pt tall and a page holds well over ten of them, so a page per
  // position would mean the break logic is firing on every row.
  for (const n of [30, 80]) {
    assert.ok((await pageCount(n)) < n / 5, `${n} positions produced too many pages`);
  }
});
