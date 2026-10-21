import { test } from "node:test";
import assert from "node:assert/strict";
import { sortiereHinweise, HINWEIS_GRENZE } from "../lib/dunning-service";
import { berechneForderung } from "../lib/dunning-claim";
import { DEFAULT_DUNNING_STAGES } from "../lib/dunning-stages";
import type { Invoice } from "../types";

/**
 * Die Rangfolge der Hinweise.
 *
 * Geprüft wird bewusst gegen die **echten** Sätze aus `berechneForderung` und
 * nicht gegen ausgedachte Texte: Die Zuordnung in `lib/dunning-service.ts`
 * erkennt einen Hinweis an einer Teilzeichenkette, und genau diese Kopplung
 * soll hier auffliegen, wenn dort jemand einen Satz umformuliert. Ein
 * umbenannter Hinweis fällt sonst still auf den Rang „unbekannt" zurück, und
 * im Dialog stünde plötzlich der falsche Satz oben.
 *
 * Die Reihenfolge selbst: Was die Forderung angreifbar macht (ungeprüfter
 * Basiszinssatz, unbekannter Schuldnertyp) steht über dem, was sie nur kleiner
 * macht (kein Verzug, Teilbetrag), und beides über dem, was nur erklärt, warum
 * die 40-€-Pauschale fehlt.
 */

const MAHNUNG = DEFAULT_DUNNING_STAGES[1]; // „1. Mahnung": Zinsen und Pauschale

const rechnung = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    company_id: "firma-1",
    status: "sent",
    invoice_type: "invoice",
    invoice_date: "2024-10-31",
    due_date: "2024-11-30",
    total_amount: 11900,
    ...over,
  }) as unknown as Invoice;

test("der ungeprüfte Basiszinssatz steht über allem anderen", () => {
  const forderung = berechneForderung({
    invoice: rechnung(),
    stufe: MAHNUNG,
    bisherigeMahnungen: [],
    customerType: null,
    verzugsbeginn: "2024-11-30",
    // Weit nach dem letzten geprüften Halbjahr: der Satz ist fortgeschrieben.
    stichtag: "2027-02-10",
    offenerBetrag: 5000,
  });

  // Vier Rohhinweise: ungeprüfter Satz, Pauschale-wegen-unbekannt,
  // unbekannter Schuldnertyp, Teilbetrag.
  assert.equal(forderung.hinweise.length, 4);
  assert.ok(forderung.stale);

  const sortiert = sortiereHinweise(forderung.hinweise);

  assert.equal(sortiert.length, 3);
  assert.match(sortiert[0], /noch nicht als geprüft hinterlegt/);
  assert.match(sortiert[1], /Vorsichtshalber werden nur/);
  assert.match(sortiert[2], /Teilbetrag/);
});

test("der Pauschale-Hinweis entfällt, wenn der Schuldnertyp ohnehin schon angesprochen ist", () => {
  const forderung = berechneForderung({
    invoice: rechnung(),
    stufe: MAHNUNG,
    bisherigeMahnungen: [],
    customerType: null,
    verzugsbeginn: "2024-11-30",
    // Vor dem Verzugsbeginn: keine Zinsen, keine Gebühr, keine Pauschale.
    stichtag: "2024-11-15",
  });

  assert.equal(forderung.hinweise.length, 3);

  const sortiert = sortiereHinweise(forderung.hinweise);

  // Der Satz „… wird nicht berechnet, weil nicht hinterlegt ist, ob der
  // Schuldner ein Unternehmen ist" wiederholt nur die zweite Hälfte des
  // allgemeinen Hinweises und kostete sonst einen der drei Plätze.
  assert.equal(sortiert.length, 2);
  assert.match(sortiert[0], /Vorsichtshalber werden nur/);
  assert.match(sortiert[1], /Der Verzug beginnt erst/);
});

test("gegenüber einem Verbraucher bleibt der erklärende Pauschale-Hinweis hinten", () => {
  const forderung = berechneForderung({
    invoice: rechnung(),
    stufe: MAHNUNG,
    bisherigeMahnungen: [],
    customerType: "consumer",
    verzugsbeginn: "2024-11-30",
    stichtag: "2027-02-10",
    offenerBetrag: 5000,
  });

  const sortiert = sortiereHinweise(forderung.hinweise);

  assert.equal(sortiert.length, 3);
  assert.match(sortiert[0], /noch nicht als geprüft hinterlegt/);
  assert.match(sortiert[1], /Teilbetrag/);
  assert.match(sortiert[2], /nur gegenüber Unternehmen zu/);
});

test("höchstens drei Hinweise, und abgeschnitten wird das, was nur erklärt", () => {
  // Von Hand gebaut: In der Praxis schließen sich einige dieser Hinweise
  // gegenseitig aus (ohne Verzug keine Zinsen und damit kein ungeprüfter
  // Satz). Die Begrenzung muss trotzdem in jeder Kombination greifen.
  const roh = [
    "Die Verzugspauschale von 40,00 € … wurde bereits mit einer früheren Mahnung berechnet …",
    "Sie mahnen einen Teilbetrag von 50,00 € …",
    "Der Verzug beginnt erst nach Ablauf des 30.11.2024 …",
    "Der Basiszinssatz für diesen Zeitraum ist in der Anwendung noch nicht als geprüft hinterlegt …",
  ];

  const sortiert = sortiereHinweise(roh);

  assert.equal(sortiert.length, HINWEIS_GRENZE);
  assert.match(sortiert[0], /noch nicht als geprüft hinterlegt/);
  assert.match(sortiert[1], /Der Verzug beginnt erst/);
  assert.match(sortiert[2], /Teilbetrag/);
});

test("ein unbekannter Hinweis fällt nicht ans Ende, sondern in die Mitte", () => {
  // Kommt in `berechneForderung` ein Hinweis hinzu, den diese Datei noch nicht
  // kennt, darf er nicht stillschweigend aus der Anzeige fallen.
  const sortiert = sortiereHinweise([
    "Die Verzugspauschale … wurde bereits mit einer früheren Mahnung berechnet …",
    "Ein ganz neuer Hinweis, den noch niemand eingeordnet hat.",
    "Der Basiszinssatz … noch nicht als geprüft hinterlegt …",
  ]);

  assert.match(sortiert[0], /noch nicht als geprüft hinterlegt/);
  assert.match(sortiert[1], /ganz neuer Hinweis/);
});
