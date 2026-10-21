import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseRateFor,
  computeDefaultInterest,
  mayChargeLateFeeFlat,
  surchargeFor,
  BASE_RATES,
  BASE_RATES_PUBLISHED_THROUGH,
  SURCHARGE_DEFAULT,
  SURCHARGE_NO_CONSUMER,
} from "../lib/dunning-interest";

/**
 * Verzugszinsen nach § 288 BGB.
 *
 * Der teure Fehlerfall steht am Anfang: Die neun Prozentpunkte gelten nur bei
 * Rechtsgeschäften, an denen *kein* Verbraucher beteiligt ist. Wer sie einem
 * Verbraucher — oder einem Kontakt, dessen Typ gar nicht gepflegt ist — in
 * Rechnung stellt, fordert zu viel. Das macht die Mahnung angreifbar und bringt
 * den Mahnenden mit der Rückzahlung des Zuviel selbst in Verzug. Deshalb ist
 * `null` (unbekannt) hier bewusst der niedrigere Satz und kein Default auf 9.
 *
 * Die Beträge unten sind von Hand aus dem veröffentlichten Basiszinssatz
 * gerechnet, damit eine Änderung an der Arithmetik begründet werden muss statt
 * stillschweigend durchzurutschen.
 */

test("unbekannter Kundentyp bekommt die 5 Punkte, nicht die 9", () => {
  assert.equal(surchargeFor(null), SURCHARGE_DEFAULT);
  assert.equal(surchargeFor(undefined), SURCHARGE_DEFAULT);
  assert.equal(surchargeFor("consumer"), SURCHARGE_DEFAULT);
  assert.equal(surchargeFor("business"), SURCHARGE_NO_CONSUMER);
});

test("ein Kontakt ohne gepflegten Typ wird wie ein Verbraucher gerechnet", () => {
  // customer_type ist NULL-bar; NULL heißt „weiß ich nicht", nicht „Firma".
  const unbekannt = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: null,
  });
  const verbraucher = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "consumer",
  });
  assert.equal(unbekannt.amount, verbraucher.amount);
  assert.equal(unbekannt.effectiveRate, verbraucher.effectiveRate);
});

test("die 40-€-Pauschale nur gegen einen sicher nicht-Verbraucher", () => {
  // § 288 Abs. 5 BGB gewährt sie gegenüber Verbrauchern nicht — und bei
  // unbekanntem Typ ist nicht belegt, dass es keiner ist.
  assert.equal(mayChargeLateFeeFlat("business"), true);
  assert.equal(mayChargeLateFeeFlat("consumer"), false);
  assert.equal(mayChargeLateFeeFlat(null), false);
  assert.equal(mayChargeLateFeeFlat(undefined), false);
});

test("der Basiszinssatz wird für den am Tag geltenden Zeitraum genommen", () => {
  assert.equal(baseRateFor("2026-08-14").rate, 1.52);
  assert.equal(baseRateFor("2026-07-01").rate, 1.52); // erster Tag der Periode
  assert.equal(baseRateFor("2026-06-30").rate, 1.27);
  assert.equal(baseRateFor("2025-03-01").rate, 2.27);
  assert.equal(baseRateFor("2020-01-01").rate, -0.88); // die lange flache Strecke
});

test("ein Tag vor Beginn der Tabelle ist ein Fehler, keine Schätzung", () => {
  // Älter als drei Jahre ist regelmäßig verjährt; lieber laut scheitern als
  // mit einem erfundenen Satz mahnen.
  assert.throws(() => baseRateFor("2010-01-01"), /Basiszinssatz/);
});

test("ein Halbjahr nach dem geprüften Stand wird als stale gemeldet", () => {
  assert.equal(baseRateFor(BASE_RATES_PUBLISHED_THROUGH).stale, false);
  assert.equal(baseRateFor("2026-06-30").stale, false); // dasselbe Halbjahr
  // Der Eintrag 2026-07-01 → 1,52 % ist fortgeschrieben, nicht verifiziert.
  assert.equal(baseRateFor("2026-07-01").stale, true);
  assert.equal(baseRateFor("2027-01-01").stale, true);
});

test("der geprüfte Stand ist selbst ein Halbjahresbeginn", () => {
  // Sonst verschiebt sich die stale-Grenze um Wochen, ohne dass es auffällt.
  assert.match(BASE_RATES_PUBLISHED_THROUGH, /-(01-01|07-01)$/);
});

test("die Basiszinstabelle ist absteigend sortiert", () => {
  // Die Suche nimmt den ersten passenden Eintrag — unsortiert liefert sie den
  // falschen Satz, ohne zu scheitern.
  for (let i = 1; i < BASE_RATES.length; i++) {
    assert.ok(
      BASE_RATES[i - 1].from > BASE_RATES[i].from,
      `${BASE_RATES[i - 1].from} sollte nach ${BASE_RATES[i].from} liegen`
    );
  }
});

test("am Fälligkeitstag selbst läuft noch nichts auf", () => {
  const amFaelligkeitstag = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-08-31",
    asOf: "2026-08-31",
    customerType: "business",
  });
  assert.equal(amFaelligkeitstag.amount, 0);
  assert.equal(amFaelligkeitstag.days, 0);
  assert.deepEqual(amFaelligkeitstag.segments, []);
});

test("der Fälligkeitstag zählt nicht mit, der letzte Tag schon", () => {
  // § 187 Abs. 1 BGB: 01.08. bis 31.08. sind 30 Tage, nicht 31 oder 32.
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-08-01",
    asOf: "2026-08-31",
    customerType: "business",
  });
  assert.equal(result.days, 30);
  assert.equal(result.segments[0].from, "2026-08-02");
  assert.equal(result.segments[0].to, "2026-08-31");
});

test("Unternehmen: Basis 1,52 + 9 Punkte über 31 Tage", () => {
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "business",
  });
  assert.equal(result.days, 31);
  assert.equal(result.segments.length, 1);
  assert.equal(result.effectiveRate, 1.52 + SURCHARGE_NO_CONSUMER); // 10,52
  // 1000 × 10,52 % × 31/365 = 8,9348
  assert.equal(result.amount, 8.93);
  // Der Satz 1,52 % ist noch nicht gegen die Bundesbank geprüft, also meldet
  // das Ergebnis stale und der Aufrufer muss ihn bestätigen lassen.
  assert.equal(result.stale, true);
});

test("ein Verbraucher bekommt 5 statt 9 Punkte aufgeschlagen", () => {
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "consumer",
  });
  assert.equal(result.effectiveRate, 1.52 + SURCHARGE_DEFAULT); // 6,52
  // 1000 × 6,52 % × 31/365 = 5,5375
  assert.equal(result.amount, 5.54);
});

test("ein Zeitraum über den 1. Juli wird an der Satzänderung geteilt", () => {
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-06-15",
    asOf: "2026-07-15",
    customerType: "business",
  });
  assert.equal(result.days, 30);
  assert.equal(result.segments.length, 2);

  const [juni, juli] = result.segments;
  assert.deepEqual(
    { from: juni.from, to: juni.to, days: juni.days, rate: juni.ratePercent },
    { from: "2026-06-16", to: "2026-06-30", days: 15, rate: 10.27 }
  );
  assert.deepEqual(
    { from: juli.from, to: juli.to, days: juli.days, rate: juli.ratePercent },
    { from: "2026-07-01", to: "2026-07-15", days: 15, rate: 10.52 }
  );

  // 1000 × 10,27 % × 15/365 = 4,2206 und 1000 × 10,52 % × 15/365 = 4,3233
  assert.equal(juni.amount, 4.22);
  assert.equal(juli.amount, 4.32);
  assert.equal(result.amount, 8.54);
  // Tagesgewichtet, weil die beiden Hälften verschiedene Sätze tragen.
  assert.equal(result.effectiveRate, 10.4);
  // Nur die zweite Hälfte liegt hinter dem geprüften Stand — das genügt.
  assert.equal(juni.stale, false);
  assert.equal(juli.stale, true);
  assert.equal(result.stale, true);
});

test("ein Schaltjahr teilt durch 366, nicht durch 365", () => {
  // Ein pauschales /365 würde im Schaltjahr einen Tag zu viel fordern.
  const result = computeDefaultInterest({
    principal: 10000,
    dueDate: "2028-01-31",
    asOf: "2028-02-29",
    customerType: "business",
    baseRateOverride: 1.52,
  });
  assert.equal(result.days, 29);
  assert.equal(result.segments[0].daysInYear, 366);
  // 10000 × 10,52 % × 29/366 = 83,3552
  assert.equal(result.amount, 83.36);
});

test("ein Zeitraum über den Jahreswechsel bekommt je Jahr seinen eigenen Teiler", () => {
  const result = computeDefaultInterest({
    principal: 10000,
    dueDate: "2027-12-16",
    asOf: "2028-01-15",
    customerType: "business",
    baseRateOverride: 1.52,
  });
  assert.equal(result.days, 30); // 15 in 2027, 15 in 2028
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].daysInYear, 365); // 2027
  assert.equal(result.segments[1].daysInYear, 366); // 2028
  // Beiderseits derselbe Satz, also bleibt der effektive Satz eine Zahl.
  assert.equal(result.effectiveRate, 10.52);
  // 10000 × 10,52 % × 15/365 = 43,2329 und × 15/366 = 43,1148 — dieselbe
  // Anzahl Tage ist im längeren Jahr etwas weniger wert.
  assert.equal(result.segments[0].amount, 43.23);
  assert.equal(result.segments[1].amount, 43.11);
  assert.equal(result.amount, 86.34);
});

test("ein Override ersetzt die Tabelle und räumt die stale-Meldung ab", () => {
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2030-01-31",
    asOf: "2030-03-02",
    customerType: "business",
    baseRateOverride: 2.5,
  });
  assert.equal(result.stale, false);
  assert.equal(result.effectiveRate, 11.5);
});

test("ohne Override wird ein Datum hinter dem geprüften Halbjahr markiert", () => {
  const result = computeDefaultInterest({
    principal: 1000,
    dueDate: "2030-01-31",
    asOf: "2030-03-02",
    customerType: "business",
  });
  assert.equal(result.stale, true);
  assert.ok(result.amount > 0, "rechnet trotzdem, aber der Aufrufer muss bestätigen");
});

test("die Abschnitte summieren sich auf den ausgewiesenen Gesamtbetrag", () => {
  // Auf der Mahnung steht die Staffel und darunter die Summe; weichen sie ab,
  // ist das Dokument in sich falsch.
  const result = computeDefaultInterest({
    principal: 4999.99,
    dueDate: "2023-02-14",
    asOf: "2026-08-31",
    customerType: "business",
  });
  const summiert = result.segments.reduce((sum, s) => sum + s.amount, 0);
  assert.equal(result.amount, Math.round(summiert * 100) / 100);
  assert.ok(result.segments.length > 5, "läuft über viele Perioden und Jahreswechsel");
});

test("keine Zinseszinsen: drei Jahre zu 9 % sind 3 × 900, nicht 2950", () => {
  // § 289 Satz 1 BGB verbietet Zinsen von Zinsen. Würde die Berechnung die
  // aufgelaufenen Zinsen auf die Hauptforderung schlagen, käme nach drei Jahren
  // 10000 × (1,09³ − 1) = 2950,29 heraus statt 2700,00.
  const result = computeDefaultInterest({
    principal: 10000,
    dueDate: "2027-12-31",
    asOf: "2030-12-31",
    customerType: "business",
    baseRateOverride: 0,
  });
  assert.equal(result.effectiveRate, 9);
  assert.equal(result.days, 366 + 365 + 365);
  assert.equal(result.amount, 2700);
  assert.notEqual(result.amount, 2950.29);
});

test("keine Zinseszinsen: zwei Zeiträume hintereinander ergeben denselben Betrag", () => {
  // Wer zweimal mahnt, darf beim zweiten Mal nicht auf Hauptforderung + Zinsen
  // weiterrechnen. August + September einzeln muss genau August–September am
  // Stück ergeben.
  const august = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "business",
  });
  const september = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-08-31",
    asOf: "2026-09-30",
    customerType: "business",
  });
  const amStueck = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-09-30",
    customerType: "business",
  });

  assert.equal(august.amount, 8.93); // 1000 × 10,52 % × 31/365
  assert.equal(september.amount, 8.65); // 1000 × 10,52 % × 30/365
  assert.equal(amStueck.amount, 17.58); // 1000 × 10,52 % × 61/365
  assert.equal(round2(august.amount + september.amount), amStueck.amount);
  // Mit Zinseszins liefe der September auf 1008,93 und ergäbe 8,73.
  assert.notEqual(september.amount, 8.73);
});

test("der Zinsbetrag ist linear im Betrag", () => {
  // Doppelter Betrag, doppelte Zinsen — bis auf den Rundungscent je Abschnitt.
  const einfach = computeDefaultInterest({
    principal: 1000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "business",
  });
  const doppelt = computeDefaultInterest({
    principal: 2000,
    dueDate: "2026-07-31",
    asOf: "2026-08-31",
    customerType: "business",
  });
  assert.ok(
    round2(Math.abs(doppelt.amount - 2 * einfach.amount)) <= 0.01,
    `${doppelt.amount} sollte rund das Doppelte von ${einfach.amount} sein`
  );
});

test("ein unmögliches Datum scheitert laut statt still 0,00 € zu liefern", () => {
  // split('-') auf einem ISO-Zeitstempel ergäbe NaN und damit lautlos keine
  // Zinsen — auf einer Mahnung der schlechteste aller Fehler.
  assert.throws(
    () =>
      computeDefaultInterest({
        principal: 1000,
        dueDate: "2026-08-31T00:00:00Z",
        asOf: "2026-09-30",
        customerType: "business",
      }),
    /Ungültiges Datum/
  );
  assert.throws(
    () =>
      computeDefaultInterest({
        principal: 1000,
        dueDate: "2026-02-30",
        asOf: "2026-09-30",
        customerType: "business",
      }),
    /Ungültiges Datum/
  );
});

test("ein Betrag von 0 oder weniger erzeugt keine Forderung", () => {
  for (const principal of [0, -100]) {
    const result = computeDefaultInterest({
      principal,
      dueDate: "2026-07-31",
      asOf: "2026-08-31",
      customerType: "business",
    });
    assert.equal(result.amount, 0);
    assert.deepEqual(result.segments, []);
  }
});

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
