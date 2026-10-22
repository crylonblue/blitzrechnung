import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateReminderPDF, type MahnschreibenInput, type MahnungFuerPdf } from "../lib/reminder-pdf";
import { computeDefaultInterest } from "../lib/dunning-interest";
import { friereZinsgrundlagenEin } from "../lib/dunning-service";
import { FOOTER_Y } from "../lib/pdf-briefbogen";
import { miss, protokolliereTexte, type GezeichneterText } from "./pdf-messung";
import type { PartySnapshot } from "../types";

/**
 * Das Mahnschreiben, gemessen.
 *
 * Zwei der Prüfungen hier sind die eigentlich teuren: **keine Steuerzeile**
 * (eine ausgewiesene Steuer auf Verzugszinsen und Mahnkosten schuldet man nach
 * § 14c UStG, obwohl sie gar nicht entsteht) und **keine eigene
 * Rechnungsnummer** (eine Mahnung darf den fortlaufenden Rechnungskreis nicht
 * anfassen). Beide laufen über **alle** Fälle, nicht nur über einen.
 *
 * Gemessen wird mit `tests/pdf-messung.ts`: die Seitenstruktur über den
 * entpackten Inhaltsstrom, der Text über ein Mitschreiben der
 * `drawText`-Aufrufe. Letzteres ist nötig, weil die Schriften als Teilmenge
 * eingebettet werden — im fertigen PDF steht der Text als Glyphennummern und
 * ist nicht lesbar.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VERKAEUFER: PartySnapshot = {
  name: "Muster GmbH",
  address: { street: "Hauptstr", streetnumber: "1", zip: "10707", city: "Berlin", country: "DE" },
  email: "rechnung@muster.de",
  vat_id: "DE123456789",
  tax_id: "30/123/45678",
  bank_details: {
    bank_name: "Test Bank",
    iban: "DE89370400440532013000",
    bic: "COBADEFFXXX",
  },
  contact: { name: "Max Muster", phone: "030123", email: "max@muster.de" },
  court: "Amtsgericht Charlottenburg",
  register_number: "HRB 123456",
  managing_director: "Maxima Muster",
};

const KAEUFER: PartySnapshot = {
  name: "Kunde AG",
  address: { street: "Kundenweg", streetnumber: "2", zip: "20095", city: "Hamburg", country: "DE" },
  email: "kunde@kunde.de",
};

const RECHNUNG = { nummer: "RE-2026-001", datum: "2026-06-08" };

function macheMahnung(overrides: Partial<MahnungFuerPdf> = {}): MahnungFuerPdf {
  return {
    stage_position: 1,
    stage_name: "Zahlungserinnerung",
    reminder_date: "2026-07-20",
    due_date: "2026-07-27",
    default_since: "2026-07-08",
    invoice_due_date: "2026-06-22",
    claimed_amount: 1190,
    fee_amount: 0,
    late_fee_flat: 0,
    interest_amount: 0,
    interest_segments: null,
    interest_rate: null,
    interest_from: null,
    interest_days: null,
    total_amount: 1190,
    seller_snapshot: VERKAEUFER as unknown as MahnungFuerPdf["seller_snapshot"],
    buyer_snapshot: KAEUFER as unknown as MahnungFuerPdf["buyer_snapshot"],
    language: "de",
    intro_text: null,
    ...overrides,
  };
}

/**
 * Eine 1. Mahnung mit allem, was eine Aufstellung rechtfertigt: Zinsen über
 * einen Zeitraum **ohne** Satzänderung, Mahnkosten und die 40-€-Pauschale.
 */
const ZINS_EIN_SATZ = computeDefaultInterest({
  principal: 1190,
  dueDate: "2025-07-10",
  asOf: "2025-09-15",
  customerType: "business",
});

/**
 * Derselbe Fall über einen Jahreswechsel mit Satzänderung hinweg: Der
 * Basiszinssatz fällt zum 01.01.2025 von 3,37 % auf 2,27 %, der Zeitraum trägt
 * also zwei Sätze. `interest_rate` bleibt dann NULL — genau der Fall, in dem
 * ein einzelner gemittelter Satz auf dem Papier falsch wäre.
 */
const ZINS_ZWEI_SAETZE = computeDefaultInterest({
  principal: 1190,
  dueDate: "2024-12-15",
  asOf: "2025-02-28",
  customerType: "business",
});

function mitAufstellung(zins: typeof ZINS_EIN_SATZ): MahnungFuerPdf {
  const grundlagen = friereZinsgrundlagenEin(zins);
  return macheMahnung({
    stage_position: 2,
    stage_name: "1. Mahnung",
    fee_amount: 2.5,
    late_fee_flat: 40,
    interest_amount: zins.amount,
    interest_segments: grundlagen.interest_segments ?? null,
    interest_rate: grundlagen.interest_rate ?? null,
    interest_from: grundlagen.interest_from ?? null,
    interest_days: grundlagen.interest_days ?? null,
    total_amount: Math.round((1190 + zins.amount + 2.5 + 40) * 100) / 100,
  });
}

/** Füllsel ohne Ziffern — die Nummernprüfung unten soll daran nicht hängen. */
const LANGER_ABSATZ =
  "Wir haben Ihre Zahlung bis heute nicht feststellen koennen und bitten Sie um kurzfristigen Ausgleich der offenen Forderung, damit uns weitere Schritte eruebrigt bleiben.";

const FAELLE: Record<string, MahnschreibenInput> = {
  // Reine Zahlungserinnerung: keine Nebenforderungen, also keine Aufstellung.
  erinnerung: { mahnung: macheMahnung(), rechnung: RECHNUNG },

  // Mahnung mit Zinsen, Mahnkosten und Pauschale — ein Satz über den ganzen
  // Zeitraum.
  mitAufstellungEinSatz: { mahnung: mitAufstellung(ZINS_EIN_SATZ), rechnung: RECHNUNG },

  // Derselbe Aufbau, aber der Zinszeitraum läuft über eine Satzänderung.
  mitAufstellungZweiSaetze: { mahnung: mitAufstellung(ZINS_ZWEI_SAETZE), rechnung: RECHNUNG },

  // Letzte Mahnung, englisch.
  englisch: {
    mahnung: {
      ...mitAufstellung(ZINS_EIN_SATZ),
      stage_position: 3,
      stage_name: "Letzte Mahnung",
      language: "en",
    },
    rechnung: RECHNUNG,
  },

  // Ein Brieftext, der über die Seite hinausläuft.
  mehrseitig: {
    mahnung: {
      ...mitAufstellung(ZINS_EIN_SATZ),
      intro_text: [
        "Sehr geehrte Damen und Herren,",
        ...Array.from({ length: 24 }, () => LANGER_ABSATZ),
        "Mit freundlichen Gruessen\nMuster GmbH",
      ].join("\n\n"),
    },
    rechnung: RECHNUNG,
  },
};

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

async function zeichne(input: MahnschreibenInput) {
  const { bytes, texte } = await protokolliereTexte(() => generateReminderPDF(input));
  return { bytes, texte, koerper: koerperTexte(texte) };
}

/**
 * Nur der Inhalt, ohne Fusszeile.
 *
 * Die Fusszeile ist Briefbogen und trägt Pflichtangaben wie „UST.-ID" und
 * „STEUER-NR.". Die gehören dorthin und sind keine Steuerzeile auf einer
 * Forderung; die Prüfungen unten sollen sie deshalb nicht sehen. Die Grenze
 * ist dieselbe, die auch der Briefbogen zieht.
 */
function koerperTexte(texte: GezeichneterText[]): GezeichneterText[] {
  return texte.filter((t) => t.y > FOOTER_Y + 20);
}

const enthaelt = (texte: GezeichneterText[], suche: string): boolean =>
  texte.some((t) => t.text.includes(suche));

// ---------------------------------------------------------------------------
// 1. Es entsteht überhaupt etwas
// ---------------------------------------------------------------------------

test("erzeugt ein lesbares, einseitiges PDF mit den eingefrorenen Angaben", async () => {
  const { bytes, koerper } = await zeichne(FAELLE.erinnerung);

  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-");

  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), "Zahlungserinnerung zu Rechnung RE-2026-001");
  assert.equal(doc.getAuthor(), "Muster GmbH");

  // Die Überschrift ist der eingefrorene Stufenname, nicht die heutige
  // Konfiguration.
  assert.ok(enthaelt(koerper, "Zahlungserinnerung"), "Stufenname fehlt");
  // Absender, Empfänger, Bezug und Frist stehen auf dem Blatt.
  assert.ok(enthaelt(koerper, "Kunde AG"), "Empfänger fehlt");
  assert.ok(enthaelt(koerper, "RE-2026-001"), "Bezug zur Rechnung fehlt");
  assert.ok(enthaelt(koerper, "08.06.2026"), "Rechnungsdatum fehlt");
  assert.ok(enthaelt(koerper, "27.07.2026"), "neue Zahlungsfrist fehlt");
  // Und die Bankverbindung, damit man überweisen kann.
  assert.ok(enthaelt(koerper, "DE89370400440532013000"), "IBAN fehlt");
  assert.ok(enthaelt(koerper, "Rechnung RE-2026-001"), "Verwendungszweck fehlt");
});

test("der Stufenname bleibt eingefroren, auch wenn er ungewöhnlich ist", async () => {
  const { koerper } = await zeichne({
    mahnung: macheMahnung({ stage_name: "Freundliche Erinnerung (Stufe A)" }),
    rechnung: RECHNUNG,
  });
  assert.ok(enthaelt(koerper, "Freundliche Erinnerung (Stufe A)"));
});

test("kein ZUGFeRD, kein XML im Dokument", async () => {
  // EN 16931 kennt nur Rechnungsarten. Wäre hier ein factur-x-Anhang drin,
  // behauptete das Blatt, eine elektronische Rechnung zu sein.
  const { bytes } = await zeichne(FAELLE.mitAufstellungEinSatz);
  const roh = Buffer.from(bytes).toString("latin1");
  for (const marker of ["factur-x", "ZUGFeRD", "AFRelationship", "EmbeddedFile", "xrechnung"]) {
    assert.ok(!roh.includes(marker), `Das Mahnschreiben enthält „${marker}"`);
  }
});

// ---------------------------------------------------------------------------
// 2. Die Aufstellung — nur wenn es etwas aufzustellen gibt
// ---------------------------------------------------------------------------

test("ohne Nebenforderungen entsteht keine Aufstellung", async () => {
  const { koerper } = await zeichne(FAELLE.erinnerung);

  for (const label of ["Forderungsaufstellung", "Offener Betrag", "Verzugszinsen", "Mahnkosten", "Gesamtforderung"]) {
    assert.ok(!enthaelt(koerper, label), `„${label}" gehört nicht auf eine reine Zahlungserinnerung`);
  }

  // Der Betrag steht trotzdem da — aber als Teil eines Satzes, nie als
  // rechtsbündige Spaltenzahl. Genau das unterscheidet den Brief von der
  // Tabelle: in der Aufstellung ist die gezeichnete Zeichenkette der blosse
  // Betrag, im Fliesstext steht er mitten im Satz.
  assert.ok(enthaelt(koerper, "1.190,00 €"), "der offene Betrag fehlt im Brieftext");
  assert.ok(
    !koerper.some((t) => t.text.trim() === "1.190,00 €"),
    "der Betrag steht als blosse Spaltenzahl da — es wurde doch eine Aufstellung gezeichnet"
  );
});

test("mit Nebenforderungen steht die Aufstellung samt Summe auf dem Blatt", async () => {
  const mahnung = FAELLE.mitAufstellungEinSatz.mahnung;
  const { koerper } = await zeichne(FAELLE.mitAufstellungEinSatz);

  for (const label of [
    "Forderungsaufstellung",
    "Offener Betrag",
    "Verzugszinsen",
    "Mahnkosten",
    "Pauschale nach § 288 Abs. 5 BGB",
    "Gesamtforderung",
  ]) {
    assert.ok(enthaelt(koerper, label), `„${label}" fehlt in der Aufstellung`);
  }

  const eur = (betrag: number) =>
    betrag.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  for (const betrag of [
    mahnung.claimed_amount,
    mahnung.interest_amount,
    mahnung.fee_amount,
    mahnung.late_fee_flat,
    mahnung.total_amount,
  ]) {
    assert.ok(enthaelt(koerper, eur(betrag)), `Betrag ${eur(betrag)} fehlt`);
  }

  // Die Aufstellung muss aufgehen — sonst behauptet das Blatt eine
  // Zusammensetzung, die nicht stimmt.
  const summe =
    mahnung.claimed_amount + mahnung.interest_amount + mahnung.fee_amount + mahnung.late_fee_flat;
  assert.equal(Math.round(summe * 100) / 100, mahnung.total_amount);
});

test("die Aufstellung wird nicht über zwei Seiten zerrissen", async () => {
  const { bytes, koerper } = await zeichne(FAELLE.mehrseitig);
  const messung = await miss(bytes);

  assert.ok(messung.seiten >= 2, `erwartet wurden mehrere Seiten, gezählt: ${messung.seiten}`);
  // Fortsetzungsseiten tragen einen Kopf, damit ein Leser weiss, was er hält.
  assert.ok(
    koerper.some((t) => t.seite > 1 && t.text.includes("Fortsetzung")),
    "die Folgeseite trägt keinen Fortsetzungskopf"
  );

  const ueberschrift = koerper.find((t) => t.text === "Forderungsaufstellung");
  const summe = koerper.find((t) => t.text === "Gesamtforderung");
  assert.ok(ueberschrift && summe, "Aufstellung fehlt");
  assert.equal(
    ueberschrift!.seite,
    summe!.seite,
    "Überschrift und Summe der Aufstellung stehen auf verschiedenen Seiten"
  );
});

// ---------------------------------------------------------------------------
// 3. Zinsen über eine Satzänderung hinweg
// ---------------------------------------------------------------------------

test("ein Zinszeitraum mit einem Satz nennt genau diesen Satz", async () => {
  assert.equal(new Set(ZINS_EIN_SATZ.segments.map((s) => s.ratePercent)).size, 1);

  const { koerper } = await zeichne(FAELLE.mitAufstellungEinSatz);
  const satz = ZINS_EIN_SATZ.segments[0].ratePercent
    .toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  assert.ok(enthaelt(koerper, `${satz} % p. a.`), `der Zinssatz ${satz} % fehlt`);
  assert.ok(
    !enthaelt(koerper, "Der Basiszinssatz hat sich"),
    "ohne Satzänderung darf keine Abschnittsliste erscheinen"
  );
});

test("ein Zinszeitraum über eine Satzänderung nennt jeden Satz einzeln", async () => {
  const abschnitte = ZINS_ZWEI_SAETZE.segments;
  const saetze = [...new Set(abschnitte.map((s) => s.ratePercent))];
  assert.ok(saetze.length > 1, "die Vorbedingung des Tests trägt nicht mehr");

  const { koerper } = await zeichne(FAELLE.mitAufstellungZweiSaetze);
  const zahl = (wert: number) =>
    wert.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  assert.ok(enthaelt(koerper, "Der Basiszinssatz hat sich"), "die Abschnitte werden nicht erklärt");
  for (const satz of saetze) {
    assert.ok(enthaelt(koerper, `${zahl(satz)} % p. a.`), `der Satz ${zahl(satz)} % fehlt`);
  }

  // Der tagesgewichtete Durchschnitt ist eine Anzeigegrösse, aus der sich der
  // Betrag nicht nachrechnen lässt. Er darf hier nicht stehen — und
  // `interest_rate` steht in diesem Fall mit gutem Grund auf NULL.
  assert.equal(FAELLE.mitAufstellungZweiSaetze.mahnung.interest_rate, null);
  assert.ok(
    !saetze.includes(ZINS_ZWEI_SAETZE.effectiveRate),
    "die Vorbedingung des Tests trägt nicht mehr"
  );
  assert.ok(
    !enthaelt(koerper, `${zahl(ZINS_ZWEI_SAETZE.effectiveRate)} % p. a.`),
    "ein gemittelter Zinssatz steht auf dem Schreiben"
  );

  // Die genannten Abschnittsbeträge addieren sich zum ausgewiesenen Zinsbetrag.
  const summe = abschnitte.reduce((s, a) => s + a.amount, 0);
  assert.equal(Math.round(summe * 100) / 100, ZINS_ZWEI_SAETZE.amount);
});

// ---------------------------------------------------------------------------
// 4. Die beiden teuren Fehler
// ---------------------------------------------------------------------------

/**
 * Wörter, die nur eine Steuerzeile mitbringt. Die Fusszeile ist bereits
 * ausgefiltert (`koerperTexte`), ihre Pflichtangaben stören hier also nicht.
 */
const STEUERWOERTER = [
  /umsatzsteuer/i,
  /mehrwertsteuer/i,
  /\bmwst/i,
  /\bvat\b/i,
  /steuerbetrag/i,
  /steuersatz/i,
  /\bnetto/i,
  /\bbrutto/i,
  /reverse.?charge/i,
  /zzgl\./i,
  /§ ?14\b/,
];

for (const name of Object.keys(FAELLE)) {
  test(`keine Steuerzeile: ${name}`, async () => {
    const { koerper } = await zeichne(FAELLE[name]);
    assert.ok(koerper.length > 0, "es wurde nichts gezeichnet");

    for (const eintrag of koerper) {
      for (const wort of STEUERWOERTER) {
        assert.ok(
          !wort.test(eintrag.text),
          `„${eintrag.text}" sieht nach einer Steuerangabe aus (${wort}). Verzugszinsen und Mahnkosten sind Schadensersatz; eine ausgewiesene Steuer darauf schuldet man nach § 14c UStG.`
        );
      }
    }
  });
}

/**
 * Was wie eine Belegnummer aussieht: **jedes** Wort, das Buchstaben und
 * Ziffern mischt.
 *
 * Bewusst so grob. Ein genaueres Muster (etwa „Buchstaben, dann Ziffern, dann
 * Bindestriche") liesse genau die Varianten durch, die hier gefährlich sind —
 * eine aus Rechnungsnummer und Stufe abgeleitete Kennung wie
 * `RE-2026-001-M2` zerfiele darin in einen erlaubten und einen unsichtbaren
 * Teil. Datumsangaben (`08.06.2026`), Beträge (`1.190,00 €`) und Postleitzahlen
 * mischen nicht und fallen von selbst heraus.
 */
function kennungen(text: string): string[] {
  return text
    .split(/\s+/)
    .map((wort) => wort.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((wort) => /[A-Za-z]/.test(wort) && /\d/.test(wort));
}

/** Die IBAN mischt ebenfalls, ist aber eine Kontoverbindung. */
const KEINE_BELEGNUMMER = new Set(["DE89370400440532013000"]);

for (const name of Object.keys(FAELLE)) {
  test(`keine eigene Rechnungsnummer: ${name}`, async () => {
    const { koerper } = await zeichne(FAELLE[name]);

    const gefunden = koerper
      .flatMap((eintrag) => kennungen(eintrag.text))
      .filter((treffer) => !KEINE_BELEGNUMMER.has(treffer));

    // Nicht leer: sonst prüfte der Test nichts.
    assert.ok(
      gefunden.includes(RECHNUNG.nummer),
      "die Nummer der gemahnten Rechnung fehlt — der Test liefe ins Leere"
    );

    for (const treffer of gefunden) {
      assert.equal(
        treffer,
        RECHNUNG.nummer,
        `„${treffer}" ist eine zweite Belegnummer auf dem Schreiben. Eine Mahnung trägt nur die Nummer der gemahnten Rechnung.`
      );
    }
  });
}

test("keine Beschriftung, die eine eigene Belegnummer behauptet", async () => {
  const { koerper } = await zeichne(FAELLE.mitAufstellungEinSatz);
  for (const label of ["RECHNUNGS-NR.", "INVOICE NO.", "Mahnungsnummer", "Belegnummer", "Mahnung Nr."]) {
    assert.ok(!enthaelt(koerper, label), `„${label}" behauptet eine eigene Nummer`);
  }
  // Was stattdessen dasteht: der Bezug.
  assert.ok(enthaelt(koerper, "RECHNUNG"));
});

// ---------------------------------------------------------------------------
// 5. Sprache
// ---------------------------------------------------------------------------

test("englische Mahnung trägt englische Beschriftungen", async () => {
  const { koerper } = await zeichne(FAELLE.englisch);

  for (const label of [
    "Breakdown of the amount due",
    "Outstanding amount",
    "Default interest",
    "Total due",
    "Bank details",
    "PAY BY",
    "Dear Sir or Madam,",
  ]) {
    assert.ok(enthaelt(koerper, label), `„${label}" fehlt`);
  }

  // Der Stufenname ist die Angabe des Nutzers und wird nicht übersetzt.
  assert.ok(enthaelt(koerper, "Letzte Mahnung"));
  // Englische Zahlen- und Datumsschreibweise.
  assert.ok(enthaelt(koerper, "€1,190.00"), "englische Betragsschreibweise fehlt");
  assert.ok(enthaelt(koerper, "06/08/2026"), "englische Datumsschreibweise fehlt");
});

// ---------------------------------------------------------------------------
// 6. Fehlende Parteien
// ---------------------------------------------------------------------------

test("ohne Absender oder Empfänger entsteht gar kein Schreiben", async () => {
  await assert.rejects(
    () => generateReminderPDF({ mahnung: macheMahnung({ seller_snapshot: null }), rechnung: RECHNUNG }),
    /kein Absender/
  );
  await assert.rejects(
    () => generateReminderPDF({ mahnung: macheMahnung({ buyer_snapshot: null }), rechnung: RECHNUNG }),
    /kein Empfänger/
  );
});

// ---------------------------------------------------------------------------
// 7. Reproduzierbarkeit
// ---------------------------------------------------------------------------

test("derselbe Datensatz ergibt zweimal dasselbe Blatt", async () => {
  // Der Kern der Zusage „eine Mahnung von vor zwei Jahren ergibt heute
  // dasselbe Blatt": nichts im Generator hängt am Kalender.
  const a = await miss(await generateReminderPDF(FAELLE.mitAufstellungZweiSaetze));
  const b = await miss(await generateReminderPDF(FAELLE.mitAufstellungZweiSaetze));
  assert.deepEqual(a, b);
});
