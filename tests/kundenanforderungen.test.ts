import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoicePDF, sanitizeParagraphs } from "../lib/pdf-generator";
import { makeInvoice } from "./helpers";
import { inflateSync } from "node:zlib";

/**
 * Anforderungen aus der Rückmeldung eines Interessenten (Oktober 2026).
 *
 * Geprüft wird hier das, was sich ohne Browser prüfen lässt: dass das PDF
 * entsteht und mit den fraglichen Eingaben umgeht, statt daran zu scheitern.
 * Die Darstellung selbst — bricht die Adresse an der richtigen Stelle um,
 * sitzen die Absätze sauber — zeigt nur das erzeugte Dokument.
 */

/**
 * Zählt die Zeichenoperationen im erzeugten PDF.
 *
 * Der Text selbst ist nicht lesbar, weil die Schriften als Teilmenge
 * eingebettet sind — die Glyphen tragen eigene Nummern statt Buchstaben. Die
 * Anzahl der Tj-Operationen entspricht aber der Anzahl gezeichneter Zeilen,
 * und genau darum geht es: Eine umbrochene Adresse belegt mehr Zeilen.
 *
 * Die Dateigrösse taugt dafür nicht. Sie wächst schon durch längeren Text,
 * ganz ohne Umbruch — ein Test darauf bestünde auch ohne die Korrektur.
 */
async function zeichenOperationen(invoice: Parameters<typeof generateInvoicePDF>[0]) {
  const buf = Buffer.from(await generateInvoicePDF(invoice, "de"));
  let inhalt = "";
  let i = 0;
  while ((i = buf.indexOf("stream", i)) !== -1) {
    const start = buf.indexOf("\n", i) + 1;
    const ende = buf.indexOf("endstream", start);
    if (ende < 0) break;
    try {
      inhalt += inflateSync(buf.subarray(start, ende)).toString("latin1");
    } catch {
      // Nicht jeder Stream ist komprimierter Seiteninhalt.
    }
    i = ende;
  }
  return (inhalt.match(/\bTj\b/g) || []).length;
}

const mitKunde = (name: string) =>
  makeInvoice({
    customer: {
      name,
      address: { street: "Hauptstr", streetNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    },
  });

test("eine lange Firmierung wird umbrochen statt in die Nachbarspalte zu laufen", async () => {
  // Der ursprünglich gemeldete Fehler: Der Empfängerblock wurde ohne
  // Breitenbegrenzung gezeichnet und lief in die Rechnungsdaten rechts.
  const kurz = await zeichenOperationen(mitKunde("Meier GmbH"));
  const lang = await zeichenOperationen(
    mitKunde("Internationale Handelsgesellschaft für Maschinenbau und Anlagentechnik mbH & Co. KG")
  );

  assert.ok(
    lang > kurz,
    `Die lange Firmierung muss zusätzliche Zeilen erzeugen (${lang} gegenüber ${kurz}). ` +
      `Gleiche Anzahl bedeutet: nicht umbrochen, also läuft der Text weiterhin über.`
  );
});

test("Absätze in der Positionsbeschreibung erzeugen zusätzliche Zeilen", async () => {
  // Vorher wurden Umbrüche durch Leerzeichen ersetzt; beide Rechnungen wären
  // dann gleich gross gewesen.
  const einzeilig = await zeichenOperationen(
    makeInvoice({
      items: [
        { description: "Beratung Teil A Beratung Teil B Beratung Teil C", quantity: 1, unit: "Std", unitPrice: 100, vatRate: 19 },
      ],
    })
  );

  const mitAbsaetzen = await zeichenOperationen(
    makeInvoice({
      items: [
        { description: "Beratung Teil A\nBeratung Teil B\nBeratung Teil C", quantity: 1, unit: "Std", unitPrice: 100, vatRate: 19 },
      ],
    })
  );

  assert.ok(
    mitAbsaetzen > einzeilig,
    `Absätze sollten zusätzliche Zeilen erzeugen (${mitAbsaetzen} vs ${einzeilig})`
  );
});

test("doppelte Umbrüche reissen keine Lücke ins Layout", () => {
  // Leere Absätze werden verworfen, sonst entstünde aus einem versehentlichen
  // Doppeldruck eine Leerzeile mitten in der Position.
  assert.deepEqual(
    sanitizeParagraphs("Zeile eins\n\n\nZeile zwei"),
    ["Zeile eins", "Zeile zwei"]
  );
});

test("Absätze werden einzeln bereinigt", () => {
  assert.deepEqual(
    sanitizeParagraphs("  Erster   Absatz \n\t Zweiter  Absatz  "),
    ["Erster Absatz", "Zweiter Absatz"]
  );
});

test("Text ohne Umbruch bleibt ein einziger Absatz", () => {
  assert.deepEqual(sanitizeParagraphs("Ganz normale Beschreibung"), ["Ganz normale Beschreibung"]);
});

test("eine Beschreibung ohne Umbruch verhält sich unverändert", async () => {
  // Rückwärtskompatibilität: Bestehende Rechnungen sehen aus wie zuvor.
  const bytes = await generateInvoicePDF(
    makeInvoice({
      items: [{ description: "Ganz normale Beschreibung", quantity: 1, unit: "Std", unitPrice: 100, vatRate: 19 }],
    }),
    "de"
  );
  assert.ok(bytes.length > 1000);
});
