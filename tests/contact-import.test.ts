import { test } from "node:test";
import assert from "node:assert/strict";
import { guessMapping, normalizeCountry, processRows, splitStreet } from "../lib/contact-import";

test("erkennt typische deutsche und englische Kopfzeilen", () => {
  const mapping = guessMapping(["Firma", "Straße", "Hausnr.", "PLZ", "Ort", "Land", "E-Mail", "USt-IdNr."]);
  assert.deepEqual(mapping, {
    name: 0, street: 1, streetnumber: 2, zip: 3, city: 4, country: 5, email: 6, vat_id: 7,
  });

  const en = guessMapping(["Company", "Address", "Zip Code", "City", "Email"]);
  assert.equal(en.name, 0);
  assert.equal(en.street, 1);
  assert.equal(en.zip, 2);
  assert.equal(en.city, 3);
  assert.equal(en.streetnumber, null);
});

test("trennt Hausnummer von der Straße", () => {
  assert.deepEqual(splitStreet("Rotebühlstr. 77"), { street: "Rotebühlstr.", streetnumber: "77" });
  assert.deepEqual(splitStreet("Am Markt 12 a"), { street: "Am Markt", streetnumber: "12a" });
  assert.deepEqual(splitStreet("Hauptstraße 12-14"), { street: "Hauptstraße", streetnumber: "12-14" });
  assert.deepEqual(splitStreet("Postfach"), { street: "Postfach", streetnumber: "" });
});

test("normalisiert Länder", () => {
  assert.equal(normalizeCountry(""), "DE");
  assert.equal(normalizeCountry("de"), "DE");
  assert.equal(normalizeCountry("Deutschland"), "DE");
  assert.equal(normalizeCountry("Österreich"), "AT");
  assert.equal(normalizeCountry("Switzerland"), "CH");
  assert.equal(normalizeCountry("Atlantis"), null);
});

test("verarbeitet Zeilen mit Fehlern, Duplikaten und Excel-PLZ", () => {
  const headers = ["Name", "Straße", "PLZ", "Ort", "Land", "E-Mail"];
  const mapping = guessMapping(headers);
  const rows: unknown[][] = [
    ["Muster GmbH", "Hauptstr. 1", 1067, "Dresden", "", "info@muster.de"],
    ["", "", "", "", "", ""],
    ["Ohne Nummer AG", "Postfach", "10115", "Berlin", "DE", ""],
    ["Atlantis Ltd", "Main St 5", "12345", "Atlantis", "Atlantis", "kaputt"],
    ["muster gmbh", "Andere Str. 2", "01067", "Dresden", "DE", ""],
    ["Bestand KG", "Weg 3", "80331", "München", "DE", ""],
  ];

  const results = processRows(rows, mapping, [{ name: "Bestand KG", zip: "80331" }]);

  assert.equal(results.length, 5, "leere Zeile wird übersprungen");

  const [muster, ohneNr, atlantis, dupInFile, dupExisting] = results;
  assert.equal(muster.line, 2);
  assert.deepEqual(muster.contact.address, {
    street: "Hauptstr.", streetnumber: "1", zip: "01067", city: "Dresden", country: "DE",
  });
  assert.deepEqual(muster.errors, []);
  assert.equal(muster.duplicate, false);

  assert.deepEqual(ohneNr.errors, ["Hausnummer fehlt"]);
  assert.deepEqual(atlantis.errors, ["Land „Atlantis“ nicht erkannt", "E-Mail ungültig"]);
  assert.equal(dupInFile.duplicate, true);
  assert.equal(dupExisting.duplicate, true);
});
