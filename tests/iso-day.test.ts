import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, formatDay, halfYearStart, parseDay, yearOf, DAY_MS } from "../lib/iso-day";

/**
 * Datumsarithmetik auf ISO-Tagen.
 *
 * Der teure Fehlerfall steht am Anfang: Ein kaputtes Datum muss laut scheitern.
 * Zerlegt man „2026-02-30" oder einen ISO-Zeitstempel naiv, entsteht
 * stillschweigend NaN — und NaN rechnet sich nicht in einen Fehler, sondern in
 * 0,00 €. Auf einer Mahnung ist das der schlechteste aller Fehler: Die
 * Verzugszinsen fallen einfach aus, und niemand sieht es.
 *
 * Der zweite teure Fall ist die Zeitzone. Diese Rechnung läuft in UTC, weil ein
 * Sommerzeitwechsel in lokaler Zeit einen Tag auf 23 oder 25 Stunden verkürzt
 * bzw. verlängert und das Ergebnis damit auf den Nachbartag kippt — eine
 * verfehlte Mahnfrist oder ein geschenkter Zinstag.
 */

// --- Strenge --------------------------------------------------------------

test("ein unmögliches Datum scheitert laut statt still NaN zu liefern", () => {
  // Date.UTC(2026, 1, 30) läuft klaglos auf den 2. März über — der
  // Rückvergleich über formatDay ist genau dagegen da.
  assert.throws(() => parseDay("2026-02-30"), /diesen Tag gibt es nicht/);
  assert.throws(() => parseDay("2025-02-29"), /diesen Tag gibt es nicht/); // kein Schaltjahr
  assert.throws(() => parseDay("2026-13-01"), /Datum/);
  assert.throws(() => parseDay("2026-00-10"), /Datum/);
  assert.throws(() => parseDay("2026-01-00"), /Datum/);
});

test("alles, was kein nackter ISO-Tag ist, wird abgewiesen", () => {
  for (const kaputt of [
    "2026-08-31T00:00:00Z", // Zeitstempel: split('-') ergäbe NaN
    "2026-08-31 00:00",
    "31.08.2026",
    "2026-8-31", // nicht aufgefüllt
    "2026-08",
    "",
    "heute",
  ]) {
    assert.throws(() => parseDay(kaputt), /erwartet wird YYYY-MM-DD/, kaputt);
  }
});

test("ein gültiger Tag kommt unverändert zurück", () => {
  for (const tag of ["2026-01-01", "2026-02-28", "2024-02-29", "2026-12-31", "2016-07-01"]) {
    assert.equal(formatDay(parseDay(tag)), tag, tag);
  }
});

// --- UTC ------------------------------------------------------------------

test("ein Tag ist immer 86.400.000 ms lang, auch über den Sommerzeitwechsel", () => {
  // Deutschland stellt 2026 am 29.03. und am 25.10. um. In lokaler Zeit wären
  // diese Differenzen 23 bzw. 25 Stunden; in UTC bleibt es bei 24.
  assert.equal(parseDay("2026-03-30") - parseDay("2026-03-29"), DAY_MS);
  assert.equal(parseDay("2026-10-26") - parseDay("2026-10-25"), DAY_MS);
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
});

test("parseDay liest nicht die lokale Zeitzone", () => {
  // Der Test läuft in irgendeiner Zone; das Ergebnis darf nicht davon abhängen.
  assert.equal(parseDay("2026-06-15"), Date.UTC(2026, 5, 15));
  assert.equal(yearOf(parseDay("2026-01-01")), 2026);
  assert.equal(yearOf(parseDay("2026-12-31")), 2026);
});

// --- Addieren -------------------------------------------------------------

test("addDays trägt über Monats-, Jahres- und Schaltjahresgrenzen", () => {
  assert.equal(addDays("2026-01-15", 30), "2026-02-14"); // der 30-Tage-Boden aus § 286 Abs. 3 BGB
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29"); // Schaltjahr
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-05-17", 0), "2026-05-17");
});

test("addDays prüft seine Eingabe genauso streng", () => {
  assert.throws(() => addDays("2026-02-30", 7), /Datum/);
});

// --- Halbjahr -------------------------------------------------------------

test("halfYearStart liefert das Halbjahr, in dem ein Tag liegt", () => {
  // Der Basiszinssatz nach § 247 BGB ändert sich zum 1.1. und zum 1.7.
  assert.equal(halfYearStart("2026-01-01"), "2026-01-01");
  assert.equal(halfYearStart("2026-06-30"), "2026-01-01");
  assert.equal(halfYearStart("2026-07-01"), "2026-07-01");
  assert.equal(halfYearStart("2026-12-31"), "2026-07-01");
});

test("halfYearStart schluckt kein erfundenes Datum", () => {
  // Ohne Prüfung ergäbe „2026-13-01" stillschweigend „2026-07-01" und damit
  // einen Basiszinssatz für ein Halbjahr, das es nicht gibt.
  assert.throws(() => halfYearStart("2026-13-01"), /Datum/);
  assert.throws(() => halfYearStart("2026-02-30"), /Datum/);
});
