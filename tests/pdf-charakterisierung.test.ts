import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoicePDF } from "../lib/pdf-generator";
import { makeInvoice } from "./helpers";
import { FAELLE, charakterisiere, type Charakterisierung } from "./pdf-charakterisierung-faelle";

/**
 * Charakterisierungstest für das Rechnungs-PDF.
 *
 * Das Rechnungs-PDF ist das Kernprodukt. Dieser Test hält fest, wie es heute
 * aussieht — Seite für Seite, Zeichenoperation für Zeichenoperation —, damit
 * Umbauten am Generator (Herauslösen gemeinsamer Teile für das Mahnschreiben)
 * nachweislich nichts am Ergebnis ändern.
 *
 * Verglichen wird der entpackte, normalisierte Inhaltsstrom jeder Seite; die
 * Begründung dafür steht in `pdf-charakterisierung-faelle.ts`. Kurz: die rohen
 * Dateibytes enthalten Millisekunden-Zeitstempel und sind damit unbrauchbar,
 * blosse Operationszahlen sind zu stumpf (zwei vertauschte Textpositionen
 * ergeben dieselbe Zahl).
 *
 * ======================================================================
 * ACHTUNG — die Werte unten stammen aus dem unveränderten Stand von
 * `lib/pdf-generator.ts` vor dem Herauslösen der gemeinsamen Layoutteile
 * (Iteration 4a, Oktober 2026). Sie sind keine Wunschwerte, sondern ein
 * Protokoll des Ist-Zustands.
 *
 * Wird dieser Test rot, ist zuerst anzunehmen, dass sich das Layout
 * ungewollt verändert hat. Die Erwartung darf NUR angepasst werden, wenn
 * die Layoutänderung ausdrücklich gewollt ist — und dann bewusst, in einem
 * eigenen Commit, mit Begründung. Sie "passend zu machen", damit der Test
 * wieder grün wird, hebt den Zweck dieser Datei auf.
 *
 * Neu erheben lassen sich die Werte, indem `charakterisiere(fall)` für jeden
 * Fall aus FAELLE ausgeführt und das Ergebnis hier eingetragen wird.
 * ======================================================================
 */
const ERWARTET: Record<keyof typeof FAELLE, Charakterisierung> = {
  einseitig: {
    seiten: 1,
    operationen: [6863],
    textzeilen: [55],
    hashes: ["c3e9d7b8c2577510"],
  },
  mehrseitig: {
    seiten: 3,
    operationen: [1278, 1467, 6435],
    textzeilen: [126, 144, 21],
    hashes: ["d17ed01b004bb3c4", "e9cbbf38db71071f", "49dcb6902cfea1b1"],
  },
  langeBeschreibungen: {
    seiten: 5,
    operationen: [788, 848, 848, 848, 6803],
    textzeilen: [77, 83, 83, 83, 56],
    hashes: [
      "b954b2440db6f284",
      "e47d2dfc45b73945",
      "17518327547d160e",
      "b09c51c58b4510a9",
      "ac4d89ba22053493",
    ],
  },
  langeFirmierung: {
    seiten: 1,
    operationen: [6903],
    textzeilen: [59],
    hashes: ["3958b0b58c67894b"],
  },
  absaetze: {
    seiten: 1,
    operationen: [6683],
    textzeilen: [58],
    hashes: ["297f03340b8573a4"],
  },
  storno: {
    seiten: 1,
    operationen: [557],
    textzeilen: [53],
    hashes: ["3022124e9c366057"],
  },
  englisch: {
    seiten: 1,
    operationen: [6991],
    textzeilen: [65],
    hashes: ["c919db4f01b6ebcc"],
  },
  kleinunternehmer: {
    seiten: 1,
    operationen: [6831],
    textzeilen: [56],
    hashes: ["1bee9dcbe3cbf6cc"],
  },
  mitGirocode: {
    seiten: 1,
    operationen: [6985],
    textzeilen: [70],
    hashes: ["0e399869d5fe0198"],
  },
  ohneGirocode: {
    seiten: 1,
    operationen: [697],
    textzeilen: [67],
    hashes: ["42a22b5f1c489f7c"],
  },
};

test("die Messgrundlage trägt: gleiche Rechnung, gleicher Inhaltsstrom", async () => {
  // Die Voraussetzung des ganzen Tests. pdf-lib zieht seine Ressourcennamen
  // aus einem je Dokument mit 1 initialisierten PRNG, der Inhaltsstrom ist
  // also reproduzierbar — die Dateibytes dagegen nicht, weil factur-x
  // Millisekunden-Zeitstempel ins XMP schreibt. Fällt diese Annahme, misst
  // der Test unten Rauschen statt Layout.
  const fall = { invoice: makeInvoice(), language: "de" as const };
  const a = await charakterisiere(fall);
  const b = await charakterisiere(fall);
  assert.deepEqual(a, b, "derselbe Fall muss zweimal dasselbe Protokoll ergeben");

  const bytesA = Buffer.from(await generateInvoicePDF(fall.invoice, "de"));
  const bytesB = Buffer.from(await generateInvoicePDF(fall.invoice, "de"));
  assert.ok(
    !bytesA.equals(bytesB),
    "Dateibytes müssen sich unterscheiden — sonst wäre die Begründung für den Umweg über den Inhaltsstrom hinfällig"
  );
});

for (const name of Object.keys(FAELLE) as (keyof typeof FAELLE)[]) {
  test(`Layout unverändert: ${name}`, async () => {
    const ist = await charakterisiere(FAELLE[name]);
    const soll = ERWARTET[name];

    // Erst die groben Masse: sie sagen, WO es klemmt, bevor der Hash nur noch
    // "irgendetwas ist anders" meldet.
    assert.equal(ist.seiten, soll.seiten, `Seitenzahl weicht ab (${name})`);
    assert.deepEqual(
      ist.operationen,
      soll.operationen,
      `Anzahl Zeichenoperationen je Seite weicht ab (${name})`
    );
    assert.deepEqual(
      ist.textzeilen,
      soll.textzeilen,
      `Anzahl gezeichneter Textzeilen je Seite weicht ab (${name})`
    );

    // Und dann der scharfe Vergleich: gleiche Anzahl, aber andere Positionen
    // oder andere Reihenfolge fällt nur hier auf.
    assert.deepEqual(
      ist.hashes,
      soll.hashes,
      `Inhaltsstrom weicht ab (${name}) — das Layout hat sich geändert, auch wenn die Zahlen gleich blieben`
    );
  });
}
