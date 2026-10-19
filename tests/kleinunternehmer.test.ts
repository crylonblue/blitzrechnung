import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alsKleinunternehmerRechnung,
  wendeKleinunternehmerAn,
  KLEINUNTERNEHMER_GRUND,
  KLEINUNTERNEHMER_HINWEIS,
} from "../lib/kleinunternehmer";
import { computeInvoiceTotals } from "../lib/invoice-totals";
import { generateXRechnungXML } from "../lib/zugferd-generator";
import { makeInvoice } from "./helpers";

/**
 * Kleinunternehmerregelung nach § 19 UStG.
 *
 * Der teure Fehlerfall steht am Anfang: Weist ein Kleinunternehmer
 * Umsatzsteuer aus, schuldet er sie nach § 14c Abs. 2 UStG dem Finanzamt,
 * obwohl er sie nie erheben durfte. Die Regel überschreibt deshalb jede
 * Position, statt nur zu warnen.
 */

test("jede Position verliert die Umsatzsteuer", () => {
  const items = wendeKleinunternehmerAn([
    { description: "Beratung", quantity: 1, unit: "Std", unitPrice: 100, vatRate: 19 },
    { description: "Material", quantity: 2, unit: "Stk", unitPrice: 50, vatRate: 7 },
  ]);

  for (const item of items) {
    assert.equal(item.vatRate, 0);
    assert.equal(item.taxCategory, "E");
    assert.equal(item.exemptionReason, KLEINUNTERNEHMER_GRUND);
  }
});

test("eine bereits gepflegte Begründung bleibt stehen", () => {
  // Der eigene Text des Nutzers ist vermutlich genauer als der Standard.
  const [item] = wendeKleinunternehmerAn([
    {
      description: "Heilbehandlung",
      quantity: 1,
      unit: "Stk",
      unitPrice: 200,
      vatRate: 0,
      exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG",
    },
  ]);
  assert.equal(item.exemptionReason, "Steuerfrei nach § 4 Nr. 14 UStG");
});

test("auch eine versehentlich auf 19 % stehende Position wird überschrieben", () => {
  // Genau das wäre sonst der § 14c-Fall: ausgewiesen, also geschuldet.
  const [item] = wendeKleinunternehmerAn([
    { description: "Vergessen umzustellen", quantity: 1, unit: "Stk", unitPrice: 1000, vatRate: 19 },
  ]);
  assert.equal(item.vatRate, 0);
  assert.equal(item.taxCategory, "E");
});

test("die Summe enthält keine Umsatzsteuer", () => {
  const rechnung = alsKleinunternehmerRechnung(
    makeInvoice({
      items: [{ description: "Beratung", quantity: 10, unit: "Std", unitPrice: 100, vatRate: 19 }],
    })
  );

  const totals = computeInvoiceTotals(
    rechnung.items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      vatRate: i.vatRate ?? 0,
      taxCategory: i.taxCategory,
      exemptionReason: i.exemptionReason,
    }))
  );

  assert.equal(totals.taxAmount, 0, "keine Steuer");
  assert.equal(totals.netTotal, 1000);
  assert.equal(totals.grossTotal, 1000, "brutto gleich netto");
});

test("der Pflichthinweis landet im Schlusstext", () => {
  // § 14 Abs. 4 Nr. 8 UStG verlangt den Hinweis auf der Rechnung selbst.
  const rechnung = alsKleinunternehmerRechnung(makeInvoice({ outroText: undefined }));
  assert.ok(rechnung.outroText?.includes(KLEINUNTERNEHMER_HINWEIS));
});

test("ein vorhandener Schlusstext bleibt erhalten", () => {
  const rechnung = alsKleinunternehmerRechnung(
    makeInvoice({ outroText: "Vielen Dank für Ihren Auftrag." })
  );
  assert.ok(rechnung.outroText?.includes("Vielen Dank für Ihren Auftrag."));
  assert.ok(rechnung.outroText?.includes(KLEINUNTERNEHMER_HINWEIS));
});

test("der Hinweis wird nicht doppelt angehängt", () => {
  const rechnung = alsKleinunternehmerRechnung(
    makeInvoice({ outroText: "Hinweis: Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." })
  );
  const treffer = (rechnung.outroText?.match(/§ 19/g) ?? []).length;
  assert.equal(treffer, 1);
});

test("die XRechnung trägt Kategorie E mit Begründung", async () => {
  // Das ist der Teil, den ein Prüfprogramm beim Empfänger liest.
  const rechnung = alsKleinunternehmerRechnung(
    makeInvoice({
      items: [{ description: "Beratung", quantity: 1, unit: "Std", unitPrice: 100, vatRate: 19 }],
    })
  );

  const xml = await generateXRechnungXML(rechnung);

  assert.ok(xml.includes("<ram:CategoryCode>E</ram:CategoryCode>"), "Kategorie E fehlt");
  assert.ok(xml.includes(KLEINUNTERNEHMER_GRUND), "Begründung (BT-120) fehlt");
  assert.ok(
    !xml.includes("<ram:RateApplicablePercent>19</ram:RateApplicablePercent>"),
    "es darf kein Steuersatz von 19 % auftauchen"
  );
});
