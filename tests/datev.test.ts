import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import {
  generateDatevBuchungsstapel,
  DATEV_ACCOUNT_DEFAULTS,
  type DatevSettings,
  type DatevInvoice,
} from "../lib/datev-generator";

const settings: DatevSettings = {
  skr: "SKR03",
  berater_nr: "1234567",
  mandanten_nr: "1001",
  wj_beginn: "0101",
  sachkontenlaenge: 4,
  debitor_konto: "10000",
  erloes_konten: DATEV_ACCOUNT_DEFAULTS.SKR03,
};
const range = { from: "2026-05-01", to: "2026-05-31" };
const NOW = new Date("2026-06-01T10:00:00Z");

function gen(invoices: DatevInvoice[]) {
  const res = generateDatevBuchungsstapel(invoices, settings, range, NOW);
  const text = iconv.decode(res.content, "win1252");
  const lines = text.split("\r\n").filter(Boolean);
  return { res, text, header: lines[0], columns: lines[1], rows: lines.slice(2) };
}

const std = (over: Partial<DatevInvoice> = {}): DatevInvoice => ({
  invoice_number: "RE-2026-042",
  invoice_date: "2026-05-31",
  invoice_type: "invoice",
  buyer_name: "Kunde AG",
  line_items: [{ quantity: 1, unit_price: 100, vat_rate: 19, tax_category: "S" }],
  ...over,
});

test("header: EXTF v700 Buchungsstapel with advisor/client and date range", () => {
  const { header, columns } = gen([std()]);
  assert.ok(header.startsWith('"EXTF";700;21;"Buchungsstapel";13;'), header);
  assert.match(header, /;1234567;1001;/); // Berater;Mandant
  assert.match(header, /;20260101;4;20260501;20260531;/); // WJ-Beginn;Länge;von;bis
  assert.match(header, /;"EUR";/);
  assert.ok(columns.startsWith('"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";'));
});

test("multi-rate invoice produces one booking per VAT group with correct accounts", () => {
  const { rows } = gen([
    std({
      line_items: [
        { quantity: 3, unit_price: 99.99, vat_rate: 19, tax_category: "S" },
        { quantity: 7, unit_price: 0.07, vat_rate: 7, tax_category: "S" },
      ],
    }),
  ]);
  assert.equal(rows.length, 2);
  const f = (r: string) => r.split(";");
  const r19 = f(rows[0]); // 19% group
  const r7 = f(rows[1]); // 7% group
  assert.equal(r19[0], "356,96"); // gross 299.97 + 56.99
  assert.equal(r19[1], '"S"');
  assert.equal(r19[6], "10000"); // Konto = Sammeldebitor
  assert.equal(r19[7], "8400"); // Gegenkonto = Erlöse 19% (SKR03)
  assert.equal(r19[9], "3105"); // Belegdatum TTMM
  assert.equal(r19[10], '"RE-2026-042"');
  assert.equal(r19[13], '"Kunde AG"');
  assert.equal(r7[0], "0,52"); // 0.49 + 0.03
  assert.equal(r7[7], "8300"); // Erlöse 7%
  // control: sum of gross equals the invoice gross total
  const sum = Number(r19[0].replace(",", ".")) + Number(r7[0].replace(",", "."));
  assert.equal(Math.round(sum * 100) / 100, 357.48);
});

test("§4 exempt line books to the tax-free account with zero VAT", () => {
  const { rows } = gen([
    std({
      line_items: [
        { quantity: 1, unit_price: 200, vat_rate: 0, tax_category: "E", exemption_reason: "§ 4 Nr. 14 UStG" },
      ],
    }),
  ]);
  const r = rows[0].split(";");
  assert.equal(r[0], "200,00"); // gross == net (no VAT)
  assert.equal(r[7], "8100"); // steuerfrei (SKR03)
});

test("cancellation reverses the booking (Soll/Haben = H)", () => {
  const { rows } = gen([
    std({
      invoice_number: "ST-2026-001",
      invoice_type: "cancellation",
      line_items: [{ quantity: -1, unit_price: 100, vat_rate: 19, tax_category: "S" }],
    }),
  ]);
  const r = rows[0].split(";");
  assert.equal(r[0], "119,00"); // positive amount
  assert.equal(r[1], '"H"'); // reversed
});

test("reverse-charge (§13b) invoices are skipped with a reason", () => {
  const { res, rows } = gen([
    std({
      invoice_number: "RE-13b",
      line_items: [{ quantity: 1, unit_price: 5000, vat_rate: 0, tax_category: "AE", exemption_reason: "§13b" }],
    }),
  ]);
  assert.equal(rows.length, 0);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /13b/);
});

test("buyer names with umlauts survive Windows-1252 encoding", () => {
  const { rows } = gen([std({ buyer_name: "Müller & Söhne GmbH" })]);
  assert.match(rows[0], /"Müller & Söhne GmbH"/);
});
