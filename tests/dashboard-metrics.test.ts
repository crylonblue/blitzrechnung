import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboardMetrics,
  type MetricsInvoice,
} from "../lib/dashboard-metrics";
import { isOverdue } from "../lib/invoice-utils";
import type { Invoice } from "../types";

/**
 * Kennzahlen der Übersicht und der Überfällig-Filter im Umgang mit Stornos.
 *
 * Eine Stornierung erzeugt einen eigenen Beleg: eigene Nummer,
 * invoice_type 'cancellation', negierte Positionen — und Status 'created',
 * weil der Beleg selbst nie storniert oder bezahlt wird. Genau dieser Status
 * hat ihn in „Offen" und „Überfällig" gespült, und weil die Ursprungsrechnung
 * gleichzeitig auf 'cancelled' steht, wirkte der Storno im Jahresumsatz
 * doppelt: einmal als fehlende Ursprungsrechnung, einmal als negativer Beleg.
 */

const rechnung = (over: Partial<MetricsInvoice>): MetricsInvoice => ({
  id: "r1",
  status: "created",
  invoice_type: "invoice",
  invoice_date: "2026-03-01",
  due_date: null,
  subtotal: 1000,
  total_amount: 1190,
  cancelled_invoice_id: null,
  ...over,
});

/** Storno zu `zuId`: negierte Beträge, eigenes Datum, Status 'created'. */
const storno = (zuId: string, over: Partial<MetricsInvoice> = {}): MetricsInvoice =>
  rechnung({
    id: `st-${zuId}`,
    invoice_type: "cancellation",
    cancelled_invoice_id: zuId,
    subtotal: -1000,
    total_amount: -1190,
    ...over,
  });

const JUNI_2026 = new Date(2026, 5, 15);

// --- Offen und Überfällig ---------------------------------------------------

test("Stornorechnung ist keine offene Forderung", () => {
  // Der Storno übernimmt das Fälligkeitsdatum der Ursprungsrechnung. Lag das in
  // der Vergangenheit, zählte er als überfällige Rechnung — mit negativem Betrag.
  const m = computeDashboardMetrics(
    [storno("r1", { due_date: "2026-01-10", invoice_date: "2026-01-05" })],
    JUNI_2026
  );

  assert.equal(m.openAmount, 0);
  assert.equal(m.overdueAmount, 0);
  assert.equal(m.overdueCount, 0);
});

test("echte unbezahlte Rechnungen zählen weiter als offen und überfällig", () => {
  const m = computeDashboardMetrics(
    [
      rechnung({ id: "a", status: "sent", due_date: "2026-01-10", total_amount: 1190 }),
      rechnung({ id: "b", status: "sent", due_date: "2026-12-10", total_amount: 238 }),
    ],
    JUNI_2026
  );

  assert.equal(m.openAmount, 1428);
  assert.equal(m.overdueAmount, 1190);
  assert.equal(m.overdueCount, 1);
});

// --- Jahresumsatz -----------------------------------------------------------

test("Storno im selben Jahr hebt die Ursprungsrechnung genau einmal auf", () => {
  const m = computeDashboardMetrics(
    [
      rechnung({ id: "a", status: "cancelled", invoice_date: "2026-03-01", subtotal: 1000 }),
      storno("a", { invoice_date: "2026-04-02" }),
    ],
    JUNI_2026
  );

  // Vorher: Ursprungsrechnung raus (Status 'cancelled') *und* Storno dazu
  // addiert — der Umsatz sank um 2.000 € statt um 1.000 €.
  assert.equal(m.revenueYearNet, 0);
});

test("Storno im Folgejahr lässt das Vorjahr stehen und mindert das laufende Jahr", () => {
  // Der Fall, in dem sich die beiden möglichen Wege unterscheiden. Gewählt ist
  // der, der abgeschlossene Perioden nicht rückwirkend ändert — wie der
  // DATEV-Export, der die Gegenbuchung zum Datum des Storno-Belegs schreibt.
  const belege = [
    rechnung({ id: "a", status: "cancelled", invoice_date: "2025-11-01", subtotal: 1000 }),
    storno("a", { invoice_date: "2026-02-03" }),
  ];

  assert.equal(
    computeDashboardMetrics(belege, new Date(2025, 11, 31)).revenueYearNet,
    1000,
    "Umsatz 2025 bleibt unberührt"
  );
  assert.equal(
    computeDashboardMetrics(belege, JUNI_2026).revenueYearNet,
    -1000,
    "die Minderung fällt ins Jahr der Stornierung"
  );
});

test("auf 'cancelled' gesetzter Status ohne Storno-Beleg fällt aus dem Umsatz", () => {
  // Über die v1-API lässt sich der Status direkt setzen, ohne dass ein Beleg
  // entsteht. Dann fehlt die Gegenbuchung, also muss die Rechnung selbst raus.
  const m = computeDashboardMetrics(
    [rechnung({ id: "a", status: "cancelled", invoice_date: "2026-03-01", subtotal: 1000 })],
    JUNI_2026
  );

  assert.equal(m.revenueYearNet, 0);
});

test("Jahresumsatz nimmt nur Belege des laufenden Jahres", () => {
  const m = computeDashboardMetrics(
    [
      rechnung({ id: "a", invoice_date: "2026-01-02", subtotal: 500 }),
      rechnung({ id: "b", invoice_date: "2025-12-31", subtotal: 900 }),
    ],
    JUNI_2026
  );

  assert.equal(m.revenueYearNet, 500);
  assert.equal(m.year, 2026);
});

// --- Filter-Chip „Überfällig" und die Badges in Tabelle/Drawer --------------

const alsInvoice = (inv: MetricsInvoice): Invoice => inv as unknown as Invoice;

test("isOverdue: Stornorechnung wird nie überfällig", () => {
  assert.equal(
    isOverdue(alsInvoice(storno("a", { due_date: "2020-01-01" }))),
    false
  );
});

test("isOverdue: unbezahlte Rechnung mit abgelaufener Frist bleibt überfällig", () => {
  assert.equal(
    isOverdue(alsInvoice(rechnung({ status: "sent", due_date: "2020-01-01" }))),
    true
  );
});
