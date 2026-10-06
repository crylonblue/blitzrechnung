import { test } from "node:test";
import assert from "node:assert/strict";
import { getUnitLabel } from "../lib/units";
import { resolveInvoiceTexts } from "../lib/invoice-texts";

test("Einheiten folgen der Rechnungssprache", () => {
  assert.equal(getUnitLabel("piece"), "Stück");
  assert.equal(getUnitLabel("piece", "en"), "Piece");
  assert.equal(getUnitLabel("hour", "en"), "Hour");
  // ältere Positionen speichern das deutsche Label
  assert.equal(getUnitLabel("Stunde", "en"), "Hour");
  // freie Einheiten bleiben unverändert
  assert.equal(getUnitLabel("Pauschale", "en"), "Pauschale");
});

test("Einleitungs- und Schlusstext je Sprache", () => {
  const company = {
    default_intro_text: "Hallo",
    default_outro_text: "Tschüss",
    default_intro_text_en: "Hello",
    default_outro_text_en: null,
  };
  assert.deepEqual(resolveInvoiceTexts(company, "de"), { introText: "Hallo", outroText: "Tschüss" });
  // kein Rückfall auf den deutschen Text
  assert.deepEqual(resolveInvoiceTexts(company, "en"), { introText: "Hello", outroText: null });
});
