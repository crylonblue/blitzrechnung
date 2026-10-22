import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baueAchse,
  zusatzForderungen,
  type AchsenMahnung,
  type AchsenRechnung,
  type AchsenStatus,
  type AchsenStufe,
} from "../lib/dunning-axis";

/**
 * Die Achse hat genau eine Aufgabe, an der sie scheitern kann: Sie darf **die
 * Leiter der Firma nicht kennen**. Jede Prüfung hier fährt deshalb dieselbe
 * Rechnung durch zwei verschiedene Leitern — eine freundliche mit
 * Zahlungserinnerung, eine direkte ohne. Was sich unterscheiden muss,
 * unterscheidet sich; alles andere bleibt gleich.
 *
 * Die zweite Leiter ist der eigentliche Prüfstein. In der ersten Fassung der
 * Oberfläche stand „Zahlungserinnerung" als erster Schritt fest verdrahtet —
 * für eine Firma, die sofort mahnt, war das schlicht gelogen.
 */

const RECHNUNG: AchsenRechnung = {
  invoice_number: "RE-2026-0003",
  invoice_date: "2026-09-07",
  due_date: "2026-10-07",
  total_amount: 2332.4,
  status: "sent",
};

const HEUTE = "2026-10-22";

function stufe(p: number, name: string, extra: Partial<AchsenStufe> = {}): AchsenStufe {
  return {
    position: p,
    name,
    bereitsErstellt: false,
    tageNachVorstufe: 7,
    fristTage: 7,
    berechnetZinsen: false,
    berechnetPauschale: false,
    gebuehr: 0,
    ...extra,
  };
}

const FREUNDLICH: AchsenStufe[] = [
  stufe(1, "Zahlungserinnerung"),
  stufe(2, "1. Mahnung", { berechnetZinsen: true, berechnetPauschale: true }),
  stufe(3, "Letzte Mahnung", { tageNachVorstufe: 14, fristTage: 10, berechnetZinsen: true }),
];

const DIREKT: AchsenStufe[] = [
  stufe(1, "1. Mahnung", { berechnetZinsen: true, berechnetPauschale: true }),
  stufe(2, "Letzte Mahnung vor Inkasso", {
    tageNachVorstufe: 10,
    fristTage: 14,
    berechnetZinsen: true,
  }),
];

function status(stufen: AchsenStufe[], extra: Partial<AchsenStatus> = {}): AchsenStatus {
  const erste = stufen[0];
  return {
    mahnbar: true,
    stufe: erste ? { position: erste.position, name: erste.name } : null,
    istFaellig: true,
    faelligAb: "2026-10-14",
    forderung: {
      offenerBetrag: 2332.4,
      zinsen: 0,
      gebuehr: 0,
      pauschale: 0,
      summe: 2332.4,
      neueFrist: "2026-10-29",
    },
    stufen,
    verlauf: [],
    ...extra,
  };
}

const titel = (stufen: AchsenStufe[], extra?: Partial<AchsenStatus>) =>
  baueAchse(RECHNUNG, status(stufen, extra), HEUTE).map((s) => s.titel);
const arten = (stufen: AchsenStufe[], extra?: Partial<AchsenStatus>) =>
  baueAchse(RECHNUNG, status(stufen, extra), HEUTE).map((s) => s.art);

test("die freundliche Leiter beginnt mit ihrer Zahlungserinnerung", () => {
  assert.deepEqual(titel(FREUNDLICH), [
    "Rechnung RE-2026-0003",
    "Zahlungsfrist abgelaufen",
    "Zahlungserinnerung",
    "1. Mahnung",
    "Letzte Mahnung",
  ]);
  assert.deepEqual(arten(FREUNDLICH), ["rechnung", "frist", "faellig", "kuenftig", "kuenftig"]);
});

test("ohne Zahlungserinnerung steht die Mahnung an erster Stelle — ohne Lücke", () => {
  const namen = titel(DIREKT);
  assert.deepEqual(namen, [
    "Rechnung RE-2026-0003",
    "Zahlungsfrist abgelaufen",
    "1. Mahnung",
    "Letzte Mahnung vor Inkasso",
  ]);
  // Der Prüfstein: Das Wort taucht nirgends auf, auch nicht als Platzhalter.
  assert.equal(
    namen.some((n) => n.includes("Zahlungserinnerung")),
    false
  );
  // Und der erste Mahnschritt ist der fällige, nicht ein übersprungener.
  assert.equal(arten(DIREKT)[2], "faellig");
});

test("der Fristablauf zählt die Verzugstage nach § 187 Abs. 1 BGB", () => {
  const frist = baueAchse(RECHNUNG, status(FREUNDLICH), HEUTE).find((s) => s.art === "frist");
  // 7. Okt ist der letzte rechtzeitige Tag; der 22. liegt 15 Tage danach.
  assert.equal(frist?.verzugsTage, 15);
});

test("eine bezahlte Rechnung zeigt keinen offenen Posten mehr", () => {
  const achse = baueAchse(
    { ...RECHNUNG, status: "paid" },
    status(FREUNDLICH, { mahnbar: false, stufe: null }),
    HEUTE
  );
  assert.deepEqual(
    achse.map((s) => s.art),
    ["rechnung"]
  );
});

test("versendete Schreiben stehen vor dem fälligen, abgelöste bleiben stehen", () => {
  const mahnung = (id: string, pos: number, name: string, extra: Partial<AchsenMahnung> = {}) =>
    ({
      id,
      stage_position: pos,
      stage_name: name,
      reminder_date: "2026-10-14",
      status: "sent",
      total_amount: 2332.4,
      superseded_by: null,
      pdf_url: "https://example.test/a.pdf",
      sent_at: "2026-10-14T09:40:00Z",
      ...extra,
    }) satisfies AchsenMahnung;

  const achse = baueAchse(
    RECHNUNG,
    status(FREUNDLICH, {
      verlauf: [
        mahnung("b", 1, "Zahlungserinnerung", { reminder_date: "2026-10-16" }),
        mahnung("a", 1, "Zahlungserinnerung (ersetzt)", { superseded_by: "b" }),
      ],
      stufe: { position: 2, name: "1. Mahnung" },
      faelligAb: "2026-10-23",
      istFaellig: false,
    }),
    HEUTE
  );

  assert.deepEqual(achse.map((s) => s.schluessel), [
    "rechnung",
    "frist",
    "a", // das ältere Schreiben zuerst — die Spur sortiert nach Datum
    "b",
    "stufe-2",
    "stufe-3",
  ]);
  // Noch nicht an der Reihe heisst nicht gesperrt: Der Schritt steht da und
  // sagt es nur dazu.
  const faellig = achse.find((s) => s.art === "faellig");
  assert.equal(faellig?.istFaellig, false);
  assert.equal(faellig?.titel, "1. Mahnung");
});

test("bereits erstellte Stufen tauchen nicht noch einmal als künftige auf", () => {
  const stufen = FREUNDLICH.map((s) =>
    s.position === 3 ? { ...s, bereitsErstellt: true } : s
  );
  assert.deepEqual(titel(stufen), [
    "Rechnung RE-2026-0003",
    "Zahlungsfrist abgelaufen",
    "Zahlungserinnerung",
    "1. Mahnung",
  ]);
});

test("künftige Stufen tragen kein ausgedachtes Datum", () => {
  for (const schritt of baueAchse(RECHNUNG, status(FREUNDLICH), HEUTE)) {
    if (schritt.art === "kuenftig") assert.equal(schritt.tag, null);
  }
});

test("der Zusatz einer Stufe benennt, was sie obendrauf fordert", () => {
  assert.deepEqual(zusatzForderungen(FREUNDLICH[0]), []);
  assert.deepEqual(zusatzForderungen(FREUNDLICH[1]), ["Verzugszinsen", "40 € Pauschale"]);
  assert.deepEqual(zusatzForderungen(DIREKT[1]), ["Verzugszinsen"]);
  assert.deepEqual(zusatzForderungen(stufe(1, "x", { gebuehr: 2.5 })), ["Mahngebühr"]);
});
