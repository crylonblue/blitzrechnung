import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_RATES, BASE_RATES_PUBLISHED_THROUGH } from "../lib/dunning-interest";

/**
 * Wachhund für die Basiszinstabelle.
 *
 * Der Basiszinssatz nach § 247 BGB wird halbjährlich neu festgesetzt, zum
 * 1. Januar und zum 1. Juli. Eine Tabelle im Code veraltet damit zweimal im
 * Jahr — lautlos, denn nichts bricht: Es wird weiter gerechnet, nur eben mit
 * dem zuletzt bekannten Satz.
 *
 * Dieser Test macht daraus eine Erinnerung mit Datum.
 *
 * Bewusst nachsichtig: Er verlangt nicht, dass die Tabelle das *laufende*
 * Halbjahr schon kennt. Die Bundesbank veröffentlicht den neuen Satz erst zum
 * Stichtag, und ein Test, der am 1. Januar zuverlässig jeden Pull Request rot
 * färbt — auch solche ohne jeden Bezug zum Mahnwesen —, wäre keine Erinnerung
 * mehr, sondern eine Handbremse. Er schlägt deshalb erst an, wenn die Tabelle
 * **zwei** Halbjahre zurückliegt. Dann ist es keine Frage des Zeitpunkts mehr,
 * sondern schlicht vergessen worden.
 */

/** Der Beginn des Halbjahrs, in dem ein Tag liegt: '2026-08-14' -> '2026-07-01'. */
function halbjahresbeginn(tag: string): string {
  const [jahr, monat] = tag.split("-");
  return Number(monat) <= 6 ? `${jahr}-01-01` : `${jahr}-07-01`;
}

/** Das Halbjahr davor: '2026-07-01' -> '2026-01-01'. */
function vorherigesHalbjahr(beginn: string): string {
  const [jahr, monat] = beginn.split("-");
  return monat === "01" ? `${Number(jahr) - 1}-07-01` : `${jahr}-01-01`;
}

test("die Basiszinstabelle liegt höchstens ein Halbjahr zurück", () => {
  const heute = new Date().toISOString().slice(0, 10);
  const laufend = halbjahresbeginn(heute);
  const geduldet = vorherigesHalbjahr(laufend);

  assert.ok(
    BASE_RATES_PUBLISHED_THROUGH >= geduldet,
    `Die Basiszinstabelle ist seit zwei Halbjahren nicht gepflegt worden: ` +
      `geprüft bis ${BASE_RATES_PUBLISHED_THROUGH}, laufendes Halbjahr ${laufend}.\n` +
      `Bitte den Basiszinssatz auf bundesbank.de nachsehen, BASE_RATES bei einer ` +
      `Änderung ergänzen und BASE_RATES_PUBLISHED_THROUGH auf ${laufend} setzen. ` +
      `Bleibt der Satz unverändert, wird KEIN Eintrag in BASE_RATES angelegt — ` +
      `nur die Konstante wandert weiter.`
  );
});

test("die Tabelle enthält keinen Satz aus einem ungeprüften Halbjahr", () => {
  // Ein ungeprüfter Wert in der Tabelle ist gefährlicher als eine Lücke: Er
  // sieht aus wie eine Tatsache, und wer das stale-Kennzeichen nicht liest,
  // mahnt damit. Fehlt der Eintrag, schreibt baseRateFor den letzten geprüften
  // Satz fort — das fordert im Zweifel zu wenig statt zu viel.
  const neuester = BASE_RATES[0].from;
  assert.ok(
    neuester <= BASE_RATES_PUBLISHED_THROUGH,
    `BASE_RATES führt einen Satz ab ${neuester}, geprüft ist aber nur bis ` +
      `${BASE_RATES_PUBLISHED_THROUGH}. Entweder den Wert bestätigen und die ` +
      `Konstante nachziehen, oder die Zeile entfernen.`
  );
});

test("die Tabelle ist absteigend sortiert", () => {
  // baseRateFor nimmt den ersten Eintrag mit from <= tag. Das stimmt nur bei
  // absteigender Sortierung — eine falsch einsortierte Zeile würde still den
  // falschen Satz liefern.
  const absteigend = [...BASE_RATES].sort((a, b) => (a.from < b.from ? 1 : -1));
  assert.deepEqual(BASE_RATES.map((p) => p.from), absteigend.map((p) => p.from));
});
