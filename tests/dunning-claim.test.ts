import { test } from "node:test";
import assert from "node:assert/strict";
import {
  berechneForderung,
  istMahnbarerStatus,
  naechsteStufe,
  verzugsbeginn,
  VERZUG_KARENZ_TAGE,
  type BisherigeMahnung,
  type ForderungInvoice,
} from "../lib/dunning-claim";
import { DEFAULT_DUNNING_STAGES, type DunningStageDefinition } from "../lib/dunning-stages";
import { LATE_FEE_FLAT } from "../lib/dunning-interest";

/**
 * Die konkrete Forderung einer Mahnung.
 *
 * Der teure Fehlerfall steht am Anfang: Ein Zahlungsziel, das der
 * Rechnungssteller einseitig auf die Rechnung druckt, verkürzt den
 * gesetzlichen Verzugseintritt nicht. Wer bei „zahlbar in 7 Tagen" ab Tag 8
 * Verzugszinsen und die 40-€-Pauschale fordert, fordert sie drei Wochen zu
 * früh — die Mahnung ist angreifbar und der Mahnende gerät mit der Rückzahlung
 * des Zuviel selbst in Verzug. § 286 Abs. 3 BGB zieht deshalb einen Boden bei
 * Rechnungsdatum + 30 Tagen, und der gilt auch dann, wenn auf der Rechnung
 * etwas Kürzeres steht.
 *
 * Die Zinsbeträge unten sind von Hand aus dem Basiszinssatz gerechnet
 * (1,27 % ab 01.07.2025, act/act, 2026 hat 365 Tage), damit eine Änderung an
 * der Arithmetik begründet werden muss, statt stillschweigend durchzurutschen.
 */

// --- Fixtures --------------------------------------------------------------

/** Normalfall: Rechnung vom 15.01.2026, Zahlungsziel 30 Tage. */
function rechnung(overrides: Partial<ForderungInvoice> = {}): ForderungInvoice {
  return {
    status: "sent",
    invoice_date: "2026-01-15",
    due_date: "2026-02-14",
    total_amount: 1000,
    ...overrides,
  };
}

function stufe(overrides: Partial<DunningStageDefinition> = {}): DunningStageDefinition {
  return { ...DEFAULT_DUNNING_STAGES[1], ...overrides }; // 1. Mahnung als Basis
}

function mahnung(overrides: Partial<BisherigeMahnung> = {}): BisherigeMahnung {
  return {
    stage_position: 1,
    due_date: "2026-02-24",
    late_fee_flat: 0,
    superseded_by: null,
    ...overrides,
  };
}

const ERSTE_MAHNUNG = stufe(); // Position 2, Zinsen + Pauschale, Gebühr 0, 7 Tage Frist

/** Der Normalfall, auf dem die meisten Tests aufsetzen. */
function forderung(overrides: Partial<Parameters<typeof berechneForderung>[0]> = {}) {
  return berechneForderung({
    invoice: rechnung(),
    stufe: ERSTE_MAHNUNG,
    bisherigeMahnungen: [],
    customerType: "business",
    verzugsbeginn: "2026-02-14",
    stichtag: "2026-03-02",
    ...overrides,
  });
}

// --- 1. Verzugsbeginn ------------------------------------------------------

test("ein einseitig verkürztes Zahlungsziel verschiebt den Verzug nicht nach vorn", () => {
  // Der teure Fall: „zahlbar innerhalb von 7 Tagen" ist keine kalendermäßige
  // Bestimmung nach § 286 Abs. 2 Nr. 1 BGB, solange sie nicht vereinbart ist.
  // Es bleibt beim Boden aus § 286 Abs. 3: Rechnungsdatum + 30 Tage.
  const beginn = verzugsbeginn({ invoice_date: "2026-01-15", due_date: "2026-01-22" });
  assert.equal(beginn, "2026-02-14");
});

test("ein längeres Zahlungsziel gilt dagegen unverändert", () => {
  // Hier fordert der Rechnungssteller weniger, als ihm zustünde — dagegen ist
  // nichts einzuwenden, der spätere Zeitpunkt gewinnt.
  const beginn = verzugsbeginn({ invoice_date: "2026-01-15", due_date: "2026-03-31" });
  assert.equal(beginn, "2026-03-31");
});

test("im Normalfall fallen beide Daten zusammen", () => {
  // Der Standard der Anwendung ist ohnehin Rechnungsdatum + 30 Tage, der Boden
  // kostet also nichts.
  assert.equal(verzugsbeginn({ invoice_date: "2026-01-15", due_date: "2026-02-14" }), "2026-02-14");
  assert.equal(VERZUG_KARENZ_TAGE, 30);
});

test("ohne Fälligkeitsdatum zählt Rechnungsdatum plus 30 Tage", () => {
  // invoices.due_date ist nullbar — über die API angelegte Rechnungen haben
  // nicht zwingend eines. Ein NULL darf hier nicht als „sofort fällig" oder
  // als NaN durchschlagen.
  assert.equal(verzugsbeginn({ invoice_date: "2026-01-15", due_date: null }), "2026-02-14");
});

test("die 30 Tage rechnen über den Monatswechsel richtig", () => {
  // Kein 30-Tage-Monat, sondern echte Kalendertage.
  assert.equal(verzugsbeginn({ invoice_date: "2026-01-31", due_date: null }), "2026-03-02");
});

test("ein nachweislich vereinbartes Zahlungsziel wird als Override übernommen", () => {
  // War das kurze Ziel vereinbart, gilt es auch — dann trägt der Nutzer die
  // Verantwortung für die Angabe, nicht die aufgedruckte Rechnung.
  const beginn = verzugsbeginn(
    { invoice_date: "2026-01-15", due_date: "2026-01-22" },
    "2026-01-22"
  );
  assert.equal(beginn, "2026-01-22");
});

test("ohne jedes Datum wird geworfen statt geraten", () => {
  assert.throws(() => verzugsbeginn({ invoice_date: null, due_date: null }), /Verzugsbeginn/);
});

// --- 2. Nächste fällige Stufe ---------------------------------------------

test("ohne Mahnung ist Stufe 1 dran, gerechnet ab dem Verzugsbeginn", () => {
  // Stichtag genau am Fälligkeitstag der Stufe — die Grenze selbst zählt mit.
  const ergebnis = naechsteStufe(DEFAULT_DUNNING_STAGES, [], "2026-02-14", "2026-02-21");
  assert.equal(ergebnis.stufe?.position, 1);
  assert.equal(ergebnis.hoechsteStufe, 0);
  // Stufe 1: 7 Tage nach Fälligkeit (Standardsatz aus lib/dunning-stages.ts).
  assert.equal(ergebnis.faelligAb, "2026-02-21");
  assert.equal(ergebnis.istFaellig, true);
  assert.equal(ergebnis.alleStufenDurchlaufen, false);
});

test("einen Tag zu früh ist die Stufe noch nicht fällig", () => {
  // Der Stichtag muss sich am Standardsatz orientieren, sonst prüft dieser
  // Test irgendwann nur noch, dass ein weit zu früher Tag zu früh ist — und
  // bestünde auch dann, wenn die Fälligkeitsrechnung kaputt wäre.
  const ergebnis = naechsteStufe(DEFAULT_DUNNING_STAGES, [], "2026-02-14", "2026-02-20");
  assert.equal(ergebnis.istFaellig, false);
});

test("ab Stufe 2 zählt die Frist der Vorstufe, nicht noch einmal deren Karenz", () => {
  // Das due_date der Vorstufe enthält ihre grace_days bereits. Wer hier erneut
  // grace_days addierte, zählte die Nachfrist doppelt und käme auf den
  // 10.03.2026 statt auf den 03.03.2026.
  const ergebnis = naechsteStufe(
    DEFAULT_DUNNING_STAGES,
    [mahnung({ stage_position: 1, due_date: "2026-02-24" })],
    "2026-02-14",
    "2026-03-03"
  );
  assert.equal(ergebnis.stufe?.position, 2);
  assert.equal(ergebnis.faelligAb, "2026-03-03");
  assert.equal(ergebnis.istFaellig, true);
});

test("eine verspätet verschickte Mahnung schiebt die nächste Stufe mit nach hinten", () => {
  // Die Fristen sind relativ zum tatsächlichen Schreiben, nicht absolut zur
  // Rechnung — sonst wäre die 2. Mahnung schon am Tag des Versands der ersten
  // fällig.
  const ergebnis = naechsteStufe(
    DEFAULT_DUNNING_STAGES,
    [mahnung({ stage_position: 1, due_date: "2026-05-10" })],
    "2026-02-14",
    "2026-03-03"
  );
  assert.equal(ergebnis.faelligAb, "2026-05-17");
  assert.equal(ergebnis.istFaellig, false);
});

test("eine abgelöste Mahnung zählt nicht als erreichte Stufe", () => {
  // superseded_by heißt: durch eine Nachfolgefassung ersetzt. Die Stufe ist
  // damit noch offen, sonst ließe sich eine zurückgezogene Mahnung nie durch
  // eine korrigierte ersetzen.
  const ergebnis = naechsteStufe(
    DEFAULT_DUNNING_STAGES,
    [mahnung({ stage_position: 1, superseded_by: "11111111-1111-1111-1111-111111111111" })],
    "2026-02-14",
    "2026-02-17"
  );
  assert.equal(ergebnis.stufe?.position, 1);
  assert.equal(ergebnis.hoechsteStufe, 0);
  // Und weil es keine gültige Vorstufe gibt, zählt wieder der Verzugsbeginn.
  assert.equal(ergebnis.faelligAb, "2026-02-21");
});

test("sind alle Stufen durch, ist das ein Zustand und kein Fehler", () => {
  const ergebnis = naechsteStufe(
    DEFAULT_DUNNING_STAGES,
    [
      mahnung({ stage_position: 1, due_date: "2026-02-24" }),
      mahnung({ stage_position: 2, due_date: "2026-03-10" }),
      mahnung({ stage_position: 3, due_date: "2026-03-24" }),
    ],
    "2026-02-14",
    "2026-04-01"
  );
  assert.equal(ergebnis.stufe, null);
  assert.equal(ergebnis.faelligAb, null);
  assert.equal(ergebnis.istFaellig, false);
  assert.equal(ergebnis.alleStufenDurchlaufen, true);
  assert.equal(ergebnis.hoechsteStufe, 3);
});

// --- 3. Die Forderung ------------------------------------------------------

test("Normalfall: Hauptforderung, Zinsen und Pauschale summieren sich", () => {
  const f = forderung();

  assert.equal(f.offenerBetrag, 1000);
  // 15.02. bis 02.03.2026 einschließlich = 16 Tage, 1,27 % + 9 = 10,27 %,
  // 1000 € * 10,27 % * 16/365 = 4,50 €.
  assert.equal(f.zinsen, 4.5);
  assert.equal(f.zinsDetails?.days, 16);
  assert.equal(f.zinsDetails?.effectiveRate, 10.27);
  assert.equal(f.gebuehr, 0); // Mahngebühr ist im Standardsatz überall 0
  assert.equal(f.pauschale, LATE_FEE_FLAT);
  assert.equal(f.summe, 1044.5);
  assert.equal(f.stale, false);
  assert.deepEqual(f.hinweise, []);
});

test("die neue Frist ist Stichtag plus die Karenz der Stufe", () => {
  const f = forderung();
  assert.equal(f.neueFrist, "2026-03-09"); // 02.03. + 7 Tage
});

test("vor dem Verzug fallen weder Zinsen noch Gebühr noch Pauschale an", () => {
  // Die Konfiguration sagt „darf", die Berechnung entscheidet „fällt an".
  const f = forderung({
    stufe: stufe({ fee_amount: 5 }),
    stichtag: "2026-02-10",
  });

  assert.equal(f.zinsen, 0);
  assert.equal(f.gebuehr, 0);
  assert.equal(f.pauschale, 0);
  assert.equal(f.zinsDetails, null);
  assert.equal(f.summe, 1000);
  assert.ok(f.hinweise.some((h) => h.includes("noch nicht in Verzug")));
});

test("am Fälligkeitstag selbst besteht noch kein Verzug", () => {
  // § 187 Abs. 1 BGB: der Tag des Ereignisses zählt nicht mit. Wer am
  // Fälligkeitstag zahlt, zahlt rechtzeitig.
  const f = forderung({ stichtag: "2026-02-14" });
  assert.equal(f.zinsen, 0);
  assert.equal(f.pauschale, 0);
  assert.ok(f.hinweise.some((h) => h.includes("noch nicht in Verzug")));
});

test("einen Tag später läuft genau ein Zinstag", () => {
  const f = forderung({ stichtag: "2026-02-15" });
  assert.equal(f.zinsDetails?.days, 1);
  // 1000 € * 10,27 % * 1/365 = 0,28 €.
  assert.equal(f.zinsen, 0.28);
  assert.equal(f.pauschale, LATE_FEE_FLAT);
});

// --- Die 40-€-Pauschale ----------------------------------------------------

test("die Pauschale fällt gegenüber einem Unternehmen an", () => {
  assert.equal(forderung({ customerType: "business" }).pauschale, LATE_FEE_FLAT);
});

test("gegenüber einem Verbraucher fällt sie nicht an", () => {
  // § 288 Abs. 5 BGB gilt nur, wenn der Schuldner kein Verbraucher ist.
  const f = forderung({ customerType: "consumer" });
  assert.equal(f.pauschale, 0);
  assert.ok(f.hinweise.some((h) => h.includes("nur gegenüber Unternehmen")));
  // Und der Zinssatz sinkt mit: 1,27 % + 5 = 6,27 %, 1000 € * 16/365 = 2,75 €.
  assert.equal(f.zinsen, 2.75);
  assert.equal(f.summe, 1002.75);
});

test("bei unbekanntem Schuldnertyp fällt sie ebenfalls nicht an", () => {
  // customer_type ist nullbar; NULL heißt „weiß ich nicht", nicht „Firma".
  const f = forderung({ customerType: null });
  assert.equal(f.pauschale, 0);
  assert.equal(f.zinsen, 2.75); // die vorsichtigen 5 Punkte
  assert.ok(f.hinweise.some((h) => h.includes("nicht hinterlegt")));
  assert.ok(f.hinweise.some((h) => h.includes("Pflegen Sie die Angabe")));
});

test("die Pauschale wird nicht zweimal berechnet", () => {
  // Einmal je Forderung, nicht je Schreiben — auch dann nicht, wenn jemand
  // charge_late_fee_flat versehentlich auf zwei Stufen gesetzt hat.
  const f = forderung({
    stufe: stufe({ position: 3, charge_late_fee_flat: true }),
    bisherigeMahnungen: [mahnung({ stage_position: 2, late_fee_flat: LATE_FEE_FLAT })],
  });

  assert.equal(f.pauschale, 0);
  assert.equal(f.summe, 1004.5); // nur Hauptforderung und Zinsen
  assert.ok(f.hinweise.some((h) => h.includes("nur einmal an")));
});

test("eine abgelöste Fassung blockiert die Pauschale nicht", () => {
  // Sie ist durch ihre Nachfolgerin ersetzt und fordert nichts mehr. Zählte
  // sie mit, ließe sich eine irrtümlich berechnete Pauschale nie korrigieren.
  const f = forderung({
    stufe: stufe({ position: 3, charge_late_fee_flat: true }),
    bisherigeMahnungen: [
      mahnung({
        stage_position: 2,
        late_fee_flat: LATE_FEE_FLAT,
        superseded_by: "11111111-1111-1111-1111-111111111111",
      }),
    ],
  });
  assert.equal(f.pauschale, LATE_FEE_FLAT);
});

test("die Korrektur derselben Stufe darf die Pauschale erneut tragen", () => {
  // Eine Korrektur rechnet nicht zusätzlich zur Vorgängerin, sondern an ihrer
  // Stelle. Zum Rechenzeitpunkt steht die Vorgängerin noch auf gültig — sie
  // kann erst abgelöst werden, wenn die neue Zeile existiert. Zählte man sie
  // mit, wäre jede Korrektur um 40 € zu niedrig.
  const f = forderung({
    bisherigeMahnungen: [mahnung({ stage_position: 2, late_fee_flat: LATE_FEE_FLAT })],
  });
  assert.equal(f.pauschale, LATE_FEE_FLAT);
});

// --- Basiszinssatz, Gebühr, Teilzahlung ------------------------------------

test("ein ungeprüfter Basiszinssatz macht die ganze Forderung stale", () => {
  // Die Oberfläche muss das später zur Bestätigung vorlegen können, statt
  // stillschweigend mit einem fortgeschriebenen Satz zu mahnen.
  const f = forderung({
    invoice: rechnung({ invoice_date: "2026-06-15", due_date: "2026-07-15" }),
    verzugsbeginn: "2026-07-15",
    stichtag: "2026-08-01",
  });

  assert.equal(f.stale, true);
  assert.ok(f.hinweise.some((h) => h.includes("Basiszinssatz")));
});

test("ein Override des Basiszinssatzes räumt stale aus", () => {
  const f = forderung({
    invoice: rechnung({ invoice_date: "2026-06-15", due_date: "2026-07-15" }),
    verzugsbeginn: "2026-07-15",
    stichtag: "2026-08-01",
    baseRateOverride: 1.52,
  });

  assert.equal(f.stale, false);
  assert.ok(!f.hinweise.some((h) => h.includes("Basiszinssatz")));
});

test("eine Mahngebühr wird übernommen, sobald Verzug besteht", () => {
  // Porto und Material sind nach § 286 Abs. 4 BGB ersatzfähig — als
  // Verzugsschaden, also erst ab Verzug.
  const f = forderung({ stufe: stufe({ fee_amount: 1.95 }) });
  assert.equal(f.gebuehr, 1.95);
  assert.equal(f.summe, 1046.45);
});

test("bei einer Teilzahlung laufen die Zinsen nur auf den Rest", () => {
  // Es gibt keine Zahlungstabelle; der offene Betrag kommt von außen.
  const f = forderung({ offenerBetrag: 400 });

  assert.equal(f.offenerBetrag, 400);
  // 400 € * 10,27 % * 16/365 = 1,80 €.
  assert.equal(f.zinsen, 1.8);
  assert.equal(f.summe, 441.8);
  assert.ok(f.hinweise.some((h) => h.includes("Teilbetrag")));
});

test("ein vollständig ausgeglichener Betrag wird nicht gemahnt", () => {
  assert.throws(() => forderung({ offenerBetrag: 0 }), /nichts zu mahnen/);
});

// --- Nicht mahnbare Rechnungen ---------------------------------------------

test("Endzustände und Entwürfe sind nicht mahnbar", () => {
  // Geworfen statt als Ergebnis mit Hinweis zurückgegeben: Bei einer
  // bezahlten, stornierten, abgeschriebenen oder nie verschickten Rechnung
  // besteht gar keine Forderung. Ein Ergebnisobjekt mit summe > 0 lädt den
  // Aufrufer ein, es trotzdem zu drucken; ein Wurf kann nicht versehentlich in
  // einem PDF landen.
  for (const status of ["draft", "paid", "cancelled", "uneinbringlich"] as const) {
    assert.equal(istMahnbarerStatus(status), false, status);
    assert.throws(
      () => forderung({ invoice: rechnung({ status }) }),
      new RegExp(status),
      status
    );
  }
});

test("offene Rechnungen sind mahnbar", () => {
  for (const status of ["created", "sent", "reminded"] as const) {
    assert.equal(istMahnbarerStatus(status), true, status);
    assert.equal(forderung({ invoice: rechnung({ status }) }).summe, 1044.5, status);
  }
});
