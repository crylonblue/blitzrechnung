import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baueMahnungsDatensatz,
  friereZinsgrundlagenEin,
  erstelleMahnung,
  ersetzeMahnung,
  verwerfeMahnung,
  ladeMahnungen,
  DunningServiceError,
  type MahnungsDatensatzInput,
} from "../lib/dunning-service";
import { berechneForderung, verzugsbeginn } from "../lib/dunning-claim";
import { DEFAULT_DUNNING_STAGES, type DunningStageDefinition } from "../lib/dunning-stages";
import type { InterestSegment } from "../lib/dunning-interest";
import type { Invoice, PartySnapshot } from "../types";

/**
 * Was eine Mahnung festhält — und was beim Ablösen nicht passieren darf.
 *
 * Zwei Dinge werden hier geprüft:
 *
 *  1. Die reine Abbildung `Forderung -> Datensatz`. Eine Funktion, die nur
 *     Felder zuordnet, ist genau dort am wertvollsten, wo sie etwas einfriert:
 *     Was hier verlorengeht, fehlt in drei Jahren, wenn jemand die Mahnung
 *     nachrechnen will.
 *  2. Die Reihenfolge beim Ablösen. Der partielle eindeutige Index
 *     `(invoice_id, stage_position) WHERE superseded_by IS NULL` lässt je Stufe
 *     nur eine gültige Fassung zu; die Tests unten bilden ihn nach und lassen
 *     den echten Service dagegen laufen.
 */

// ---------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------

const KAEUFER: PartySnapshot = {
  id: "k1",
  name: "Mandel GmbH",
  address: { street: "Hauptstr.", streetnumber: "3", city: "Köln", zip: "50667", country: "DE" },
  email: "buchhaltung@mandel.example",
  vat_id: "DE123456789",
};

const VERKAEUFER: PartySnapshot = {
  name: "Blitz Handwerk",
  address: { street: "Werkweg", streetnumber: "1", city: "Bonn", zip: "53111", country: "DE" },
};

const rechnung = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv-1",
    company_id: "firma-1",
    status: "sent",
    invoice_type: "invoice",
    invoice_number: "INV-0007",
    invoice_date: "2024-10-31",
    due_date: "2024-11-30",
    seller_is_self: true,
    seller_contact_id: null,
    seller_snapshot: VERKAEUFER,
    buyer_is_self: false,
    buyer_contact_id: "k1",
    buyer_snapshot: KAEUFER,
    line_items: [],
    subtotal: 10000,
    vat_amount: 1900,
    total_amount: 11900,
    recipient_email: null,
    language: "de",
    intro_text: null,
    outro_text: null,
    contact_person_id: null,
    cancelled_invoice_id: null,
    created_at: "2024-10-31T10:00:00Z",
    updated_at: "2024-10-31T10:00:00Z",
    ...over,
  }) as unknown as Invoice;

const firma = () => ({
  id: "firma-1",
  name: "Blitz Handwerk",
  address: VERKAEUFER.address,
  vat_id: "DE999999999",
  tax_id: null,
  bank_details: { bank_name: "Sparkasse", iban: "DE02100100100006820101", bic: "PBNKDEFF" },
  contact_name: "Rita Blitz",
  contact_email: "rita@blitz.example",
  contact_phone: null,
  additional_contacts: [],
  court: null,
  register_number: null,
  managing_director: null,
});

/** Die 1. Mahnung aus dem Standardsatz: Zinsen und 40-€-Pauschale. */
const STUFE_2 = DEFAULT_DUNNING_STAGES[1];

/**
 * Eine fertig berechnete Forderung, so wie der Dialog sie dem Nutzer zeigt.
 * Die Rechnung war am 30.11.2024 fällig; der Stichtag bestimmt, über wie viele
 * Satzwechsel die Zinsen laufen.
 */
function forderungZum(stichtag: string, stufe: DunningStageDefinition = STUFE_2, inv = rechnung()) {
  return berechneForderung({
    invoice: inv,
    stufe,
    bisherigeMahnungen: [],
    customerType: "business",
    verzugsbeginn: verzugsbeginn(inv),
    stichtag,
  });
}

function datensatzZum(
  stichtag: string,
  stufe: DunningStageDefinition = STUFE_2,
  over: Partial<MahnungsDatensatzInput> = {}
) {
  const inv = rechnung();
  return baueMahnungsDatensatz({
    companyId: "firma-1",
    invoiceId: inv.id,
    stufe,
    forderung: forderungZum(stichtag, stufe, inv),
    reminderDate: stichtag,
    defaultSince: verzugsbeginn(inv),
    invoiceDueDate: inv.due_date,
    language: "de",
    sellerSnapshot: VERKAEUFER,
    buyerSnapshot: KAEUFER,
    recipientEmail: KAEUFER.email ?? null,
    ...over,
  });
}

const segmenteVon = (d: ReturnType<typeof datensatzZum>) =>
  d.interest_segments as unknown as InterestSegment[];

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Was das Dokument zeigt, steht im Datensatz
// ---------------------------------------------------------------------------

test("alle anzeigerelevanten Werte landen eingefroren im Datensatz", () => {
  const inv = rechnung();
  const forderung = forderungZum("2025-03-31");
  const d = datensatzZum("2025-03-31");

  // Die Stufe als Kopie — kein Fremdschlüssel, der beim Umbenennen oder
  // Zurücksetzen der Stufenkonfiguration den Briefkopf mitzöge.
  assert.equal(d.stage_position, STUFE_2.position);
  assert.equal(d.stage_name, STUFE_2.name);
  assert.equal(d.intro_text, STUFE_2.intro_text);
  assert.equal(d.outro_text, STUFE_2.outro_text);

  // Beträge genau so, wie sie dem Nutzer gezeigt wurden.
  assert.equal(d.claimed_amount, forderung.offenerBetrag);
  assert.equal(d.interest_amount, forderung.zinsen);
  assert.equal(d.fee_amount, forderung.gebuehr);
  assert.equal(d.late_fee_flat, forderung.pauschale);
  assert.equal(d.total_amount, forderung.summe);

  // Fristen: die neue, die diese Mahnung einräumt, und die alte der Rechnung.
  assert.equal(d.reminder_date, "2025-03-31");
  assert.equal(d.due_date, forderung.neueFrist);
  // Beide Tage, getrennt: der Verzugsbeginn für „seit dem … in Verzug", die
  // Fälligkeit der Rechnung für „zahlbar bis …".
  assert.equal(d.default_since, verzugsbeginn(inv));
  assert.equal(d.invoice_due_date, inv.due_date);

  // Parteien und Sprache.
  assert.deepEqual(d.seller_snapshot, VERKAEUFER);
  assert.deepEqual(d.buyer_snapshot, KAEUFER);
  assert.equal(d.language, "de");
  assert.equal(d.recipient_email, KAEUFER.email);

  // Ein Entwurf: versendet wird später und anderswo.
  assert.equal(d.status, "created");
  assert.equal(d.sent_at, null);
  assert.equal(d.superseded_by, null);

  // Gegenprobe: Dieselbe Forderung, aber eine andere Stufe — wenn die
  // Zusicherungen oben etwas aussagen, muss sich hier etwas ändern. (Sonst
  // hätte der Test auch eine Abbildung bestanden, die Konstanten schreibt.)
  const andere = datensatzZum("2025-03-31", DEFAULT_DUNNING_STAGES[2]);
  assert.notEqual(andere.stage_name, d.stage_name);
  assert.notEqual(andere.stage_position, d.stage_position);
  // Stufe 3 berechnet die Pauschale nicht noch einmal — also eine andere Summe.
  assert.notEqual(andere.total_amount, d.total_amount);
});

test("ein verkürztes Zahlungsziel trennt Verzugsbeginn und Fälligkeit", () => {
  // Der Fall, für den es zwei Spalten braucht. Die Rechnung vom 31.10.2024
  // druckt "zahlbar innerhalb von 14 Tagen", ist also am 14.11. fällig. Das
  // ist aber eine einseitige Ansage und keine kalendermäßige Bestimmung nach
  // § 286 Abs. 2 Nr. 1 BGB — der gesetzliche Verzug tritt trotzdem erst 30
  // Tage nach Rechnungsdatum ein, am 30.11.
  //
  // Das Mahnschreiben braucht beide Daten und darf sie nicht verwechseln:
  // "zahlbar bis 14.11.2024" und "seit dem 01.12.2024 in Verzug". Stünde in
  // invoice_due_date der Verzugsbeginn, druckte das PDF eine Fälligkeit, die
  // nie auf der Rechnung stand — und ab der der Schuldner auch keine Zinsen
  // schuldet.
  const inv = rechnung({ invoice_date: "2024-10-31", due_date: "2024-11-14" });
  const d = baueMahnungsDatensatz({
    companyId: "firma-1",
    invoiceId: inv.id,
    stufe: STUFE_2,
    forderung: forderungZum("2025-03-31", STUFE_2, inv),
    reminderDate: "2025-03-31",
    defaultSince: verzugsbeginn(inv),
    invoiceDueDate: inv.due_date,
    language: "de",
    sellerSnapshot: VERKAEUFER,
    buyerSnapshot: KAEUFER,
    recipientEmail: null,
  });

  assert.equal(d.invoice_due_date, "2024-11-14", "was auf der Rechnung stand");
  assert.equal(d.default_since, "2024-11-30", "§ 286 Abs. 3 BGB: 30 Tage");
  assert.notEqual(d.default_since, d.invoice_due_date);

  // Die Zinsen laufen ab dem Verzugsbeginn, nicht ab der Fälligkeit — die
  // 16 Tage dazwischen sind zinsfrei.
  assert.equal(d.interest_from, "2024-12-01");
});

test("eine Rechnung ohne Fälligkeitsdatum lässt invoice_due_date leer", () => {
  // Nullbar mit Absicht: Ein hilfsweise eingesetzter Wert sähe aus wie eine
  // Angabe von der Rechnung und stünde dort nicht. Der Verzugsbeginn dagegen
  // ist immer bestimmbar und bleibt NOT NULL.
  const inv = rechnung({ due_date: null });
  const d = baueMahnungsDatensatz({
    companyId: "firma-1",
    invoiceId: inv.id,
    stufe: STUFE_2,
    forderung: forderungZum("2025-03-31", STUFE_2, inv),
    reminderDate: "2025-03-31",
    defaultSince: verzugsbeginn(inv),
    invoiceDueDate: inv.due_date,
    language: "de",
    sellerSnapshot: VERKAEUFER,
    buyerSnapshot: KAEUFER,
    recipientEmail: null,
  });

  assert.equal(d.invoice_due_date, null);
  assert.equal(d.default_since, "2024-11-30");
});

test("die Summe ist die Summe ihrer Teile", () => {
  // Spiegelt den CHECK payment_reminders_total_is_sum, der in NUMERIC exakt
  // nachrechnet und keinen Rundungsrest duldet.
  for (const stichtag of ["2024-12-15", "2025-03-31", "2026-01-15"]) {
    const d = datensatzZum(stichtag);
    assert.equal(
      d.total_amount,
      round2(
        (d.claimed_amount as number) +
          (d.fee_amount as number) +
          (d.late_fee_flat as number) +
          (d.interest_amount as number)
      ),
      `Stichtag ${stichtag}`
    );
  }
});

test("eine Mahnung trägt weder Umsatzsteuer noch Rechnungsnummer", () => {
  // Verzugszinsen und Mahnkosten sind Schadensersatz, kein Leistungsaustausch;
  // und eine Mahnung darf den fortlaufenden Rechnungskreis nicht anfassen.
  const d = datensatzZum("2025-03-31") as Record<string, unknown>;
  for (const feld of ["vat_amount", "vat_rate", "subtotal", "invoice_number", "line_items"]) {
    assert.equal(feld in d, false, `${feld} hat auf einer Mahnung nichts zu suchen`);
  }
});

// ---------------------------------------------------------------------------
// 2. Die Zinsgrundlagen
// ---------------------------------------------------------------------------

test("mehrere Zinssegmente gehen nicht verloren", () => {
  // 01.12.2024 bis 31.03.2025: Der Basiszinssatz wechselt zum 01.01.2025 von
  // 3,37 auf 2,27 — der Zeitraum zerfällt in zwei Abschnitte mit zwei Sätzen.
  const d = datensatzZum("2025-03-31");
  const segmente = segmenteVon(d);

  assert.equal(segmente.length, 2);
  assert.equal(new Set(segmente.map((s) => s.ratePercent)).size, 2);
  assert.deepEqual(
    segmente.map((s) => s.from),
    ["2024-12-01", "2025-01-01"]
  );
  // Act/act: jedes Teilstück liegt in genau einem Kalenderjahr und wird durch
  // dessen echte Länge geteilt. Auch das muss eingefroren sein.
  assert.deepEqual(
    segmente.map((s) => s.daysInYear),
    [366, 365]
  );

  // Die Abschnitte tragen den Betrag: aus ihnen allein lässt er sich exakt
  // nachrechnen.
  assert.equal(
    round2(segmente.reduce((summe, s) => summe + s.amount, 0)),
    d.interest_amount
  );

  // Gegenprobe — und zugleich der Grund, warum es die Spalte überhaupt gibt:
  // Wer stattdessen mit dem einen „effektiven" Satz nachrechnet, landet neben
  // dem geforderten Betrag. Ein einzelner Skalar hätte genau diese Abweichung
  // unsichtbar gemacht.
  const zinsDetails = forderungZum("2025-03-31").zinsDetails!;
  const naiv = round2(
    ((d.claimed_amount as number) * (zinsDetails.effectiveRate / 100) * zinsDetails.days) / 365
  );
  assert.notEqual(naiv, d.interest_amount);
});

test("die Skalare bleiben leer, sobald der Zeitraum mehr als einen Satz trägt", () => {
  const d = datensatzZum("2025-03-31");

  // Lieber eine ehrliche Lücke als ein tagesgewichteter Durchschnitt, den
  // jemand für den geltenden Satz hält.
  assert.equal(d.interest_rate, null);
  assert.equal(d.base_rate, null);

  // Erster Zinstag und Zinstage bleiben dagegen eindeutig und werden gesetzt.
  assert.equal(d.interest_from, "2024-12-01");
  assert.equal(d.interest_days, 121);
});

test("ein einziger Satz bleibt als Anzeigewert erhalten", () => {
  // 01.12.2024 bis 31.12.2024 liegt ganz vor dem Satzwechsel.
  const d = datensatzZum("2024-12-31");
  const segmente = segmenteVon(d);

  assert.equal(segmente.length, 1);
  assert.equal(d.interest_rate, segmente[0].ratePercent);
  assert.equal(d.base_rate, segmente[0].baseRate);
  assert.equal(d.interest_from, "2024-12-01");
  assert.equal(d.interest_days, 31);
});

test("maßgeblich ist die Zahl der Sätze, nicht die Zahl der Abschnitte", () => {
  // Der Basiszinssatz lag von Mitte 2016 bis Ende 2022 unverändert bei -0,88.
  // Über den Jahreswechsel hinweg entstehen trotzdem zwei Abschnitte — wegen
  // des Teilers (366/365), nicht wegen des Satzes. Ein druckbarer Satz
  // existiert hier also sehr wohl.
  const grundlagen = friereZinsgrundlagenEin({
    amount: 100,
    days: 90,
    effectiveRate: 4.12,
    stale: false,
    segments: [
      { from: "2020-12-01", to: "2020-12-31", days: 31, baseRate: -0.88, ratePercent: 4.12, daysInYear: 366, amount: 0.35, stale: false },
      { from: "2021-01-01", to: "2021-02-28", days: 59, baseRate: -0.88, ratePercent: 4.12, daysInYear: 365, amount: 0.67, stale: false },
    ],
  });

  assert.equal(grundlagen.interest_rate, 4.12);
  assert.equal(grundlagen.base_rate, -0.88);
  assert.equal(grundlagen.interest_from, "2020-12-01");
  assert.equal(grundlagen.interest_days, 90);
});

test("ohne Zinsen bleiben alle Zinsgrundlagen leer", () => {
  // Stufe 1 (Zahlungserinnerung) berechnet bewusst keine Zinsen.
  const d = datensatzZum("2025-03-31", DEFAULT_DUNNING_STAGES[0]);

  assert.equal(d.interest_amount, 0);
  // NULL und nicht 0: eine 0 als Zinssatz wäre eine Aussage, und hier wurde
  // nichts ausgesagt. Der CHECK payment_reminders_interest_has_segments lässt
  // fehlende Abschnitte nur zu, solange auch kein Betrag gefordert wird.
  assert.equal(d.interest_segments, null);
  assert.equal(d.interest_rate, null);
  assert.equal(d.base_rate, null);
  assert.equal(d.interest_from, null);
  assert.equal(d.interest_days, null);
});

// ---------------------------------------------------------------------------
// 3. Ein Modell der Datenbank
// ---------------------------------------------------------------------------
//
// Gerade genug Supabase, um den echten Service dagegen laufen zu lassen. Das
// Entscheidende daran ist nicht die Abfrage-API, sondern `pruefeIndex`: der
// partielle eindeutige Index aus Migration 040, nachgebaut und nach **jedem
// einzelnen Schreibvorgang** ausgewertet. Genau das macht Postgres auch — eine
// Transaktion verschiebt die Prüfung nicht ans Ende.

 
type Zeile = Record<string, any>;

const fehler = (code: string, message: string) => Object.assign(new Error(message), { code });

/** idx_payment_reminders_active_stage: je Rechnung und Stufe eine gültige Fassung. */
function pruefeIndex(zeilen: Zeile[]) {
  const gesehen = new Set<string>();
  for (const z of zeilen.filter((r) => r.superseded_by === null)) {
    const schluessel = `${z.invoice_id}|${z.stage_position}`;
    if (gesehen.has(schluessel)) {
      throw fehler("23505", "idx_payment_reminders_active_stage verletzt");
    }
    gesehen.add(schluessel);
  }
}

/** superseded_by REFERENCES payment_reminders(id). */
function pruefeFremdschluessel(zeilen: Zeile[]) {
  for (const z of zeilen) {
    if (z.superseded_by !== null && !zeilen.some((o) => o.id === z.superseded_by)) {
      throw fehler("23503", "superseded_by zeigt ins Leere");
    }
  }
}

class Abfrage {
  private art: "select" | "insert" | "delete" = "select";
  private filter: Array<[string, unknown]> = [];
  private zeile: Zeile | null = null;

  constructor(
    private readonly tabellen: Record<string, Zeile[]>,
    private readonly tabelle: string
  ) {}

  select() {
    return this;
  }
  order() {
    return this;
  }
  eq(spalte: string, wert: unknown) {
    this.filter.push([spalte, wert]);
    return this;
  }
  insert(zeile: Zeile) {
    this.art = "insert";
    this.zeile = zeile;
    return this;
  }
  delete() {
    this.art = "delete";
    return this;
  }

  private treffer(): Zeile[] {
    return this.tabellen[this.tabelle].filter((z) =>
      this.filter.every(([spalte, wert]) => z[spalte] === wert)
    );
  }

  private lauf(): { data: any; error: any } {
    const zeilen = this.tabellen[this.tabelle];
    if (this.art === "insert") {
      const neu = { id: `pr-${zeilen.length + 1}`, created_at: new Date(2026, 0, zeilen.length + 1).toISOString(), superseded_by: null, ...this.zeile };
      zeilen.push(neu);
      try {
        pruefeIndex(zeilen);
        pruefeFremdschluessel(zeilen);
      } catch (e) {
        zeilen.pop();
        return { data: null, error: e };
      }
      return { data: [neu], error: null };
    }
    if (this.art === "delete") {
      const weg = this.treffer();
      for (const z of weg) {
        zeilen.splice(zeilen.indexOf(z), 1);
        // ON DELETE SET NULL: die Vorgängerin wird wieder gültig.
        for (const andere of zeilen) {
          if (andere.superseded_by === z.id) andere.superseded_by = null;
        }
      }
      return { data: weg, error: null };
    }
    return { data: this.treffer(), error: null };
  }

  single() {
    const { data, error } = this.lauf();
    if (error) return Promise.resolve({ data: null, error });
    const zeilen = data as Zeile[];
    return Promise.resolve(
      zeilen.length === 1
        ? { data: zeilen[0], error: null }
        : { data: null, error: fehler("PGRST116", "kein eindeutiges Ergebnis") }
    );
  }

  /** Macht die Abfrage `await`-bar, so wie der echte Query-Builder. */
  then<TErfuellt = { data: any; error: any }, TAbgelehnt = never>(
    onfulfilled?: ((v: { data: any; error: any }) => TErfuellt | PromiseLike<TErfuellt>) | null,
    onrejected?: ((reason: unknown) => TAbgelehnt | PromiseLike<TAbgelehnt>) | null
  ): PromiseLike<TErfuellt | TAbgelehnt> {
    return Promise.resolve(this.lauf()).then(onfulfilled, onrejected);
  }
}

/** Ein Client, der gerade so viel kann, wie lib/dunning-service.ts aufruft. */
function macheClient(tabellen: Record<string, Zeile[]>) {
  return {
    from: (tabelle: string) => new Abfrage(tabellen, tabelle),
    rpc: (name: string, args: Record<string, string>) => {
      assert.equal(name, "supersede_payment_reminder");
      const zeilen = tabellen.payment_reminders;
      const lauf = () => {
        const alt = zeilen.find((z) => z.id === args.p_old_id);
        const neu = zeilen.find((z) => z.id === args.p_new_id);
        if (!alt || !neu) return { data: null, error: fehler("22023", "nicht gefunden") };
        if (alt.superseded_by !== null) return { data: null, error: fehler("23505", "bereits abgelöst") };
        if (neu.superseded_by !== alt.id) return { data: null, error: fehler("22023", "nicht geparkt") };
        try {
          // Schritt 1: die alte verliert ihre Gültigkeit. Danach ist für einen
          // Augenblick keine Fassung gültig — in der Transaktion sieht das
          // niemand, und der Index ist zufrieden.
          alt.superseded_by = neu.id;
          pruefeIndex(zeilen);
          // Schritt 2: die neue bekommt sie.
          neu.superseded_by = null;
          pruefeIndex(zeilen);
        } catch (e) {
          return { data: null, error: e };
        }
        return { data: [{ ...neu }], error: null };
      };
      return {
        single: () => {
          const { data, error } = lauf();
          return Promise.resolve(
            error ? { data: null, error } : { data: (data as Zeile[])[0], error: null }
          );
        },
      };
    },
  } as any;
}

function umgebung() {
  const tabellen: Record<string, Zeile[]> = {
    invoices: [rechnung() as unknown as Zeile],
    companies: [firma()],
    payment_reminders: [],
  };
  return { tabellen, supabase: macheClient(tabellen) };
}

const CTX = { companyId: "firma-1" };

const params = (stichtag = "2025-03-31", stufe: DunningStageDefinition = STUFE_2) => ({
  invoiceId: "inv-1",
  stufe,
  forderung: forderungZum(stichtag, stufe),
  reminderDate: stichtag,
  defaultSince: verzugsbeginn(rechnung()),
});

// ---------------------------------------------------------------------------
// 4. Anlegen
// ---------------------------------------------------------------------------

test("erstelleMahnung legt einen Entwurf an und friert die Parteien ein", async () => {
  const { tabellen, supabase } = umgebung();
  const mahnung = await erstelleMahnung(supabase, CTX, params());

  assert.equal(mahnung.status, "created");
  assert.equal(mahnung.sent_at, null);
  assert.equal(mahnung.superseded_by, null);
  assert.equal(mahnung.invoice_id, "inv-1");
  // Absender aus der heutigen Firmenzeile — die Mahnung fordert zur Zahlung
  // auf und muss das aktuelle Konto nennen.
  assert.equal((mahnung.seller_snapshot as any).bank_details.iban, firma().bank_details.iban);
  // Empfänger aus dem Snapshot der Rechnung, nicht aus dem heutigen Kontakt.
  assert.equal((mahnung.buyer_snapshot as any).name, KAEUFER.name);

  // Eingefroren heisst eingefroren: die Firma wird umbenannt und bekommt ein
  // neues Konto, die bereits geschriebene Mahnung bleibt, was sie war.
  tabellen.companies[0].name = "Blitz Handwerk & Söhne";
  tabellen.companies[0].bank_details = { iban: "DE00000000000000000000" };
  const [geladen] = await ladeMahnungen(supabase, CTX, "inv-1");
  assert.equal((geladen.seller_snapshot as any).name, "Blitz Handwerk");
  assert.equal((geladen.seller_snapshot as any).bank_details.iban, firma().bank_details.iban);
});

test("erstelleMahnung nimmt die Fälligkeit roh aus der Rechnung", async () => {
  // Der Service bekommt nur den Verzugsbeginn übergeben; die Fälligkeit liest
  // er aus der Rechnung, die er ohnehin lädt. So kann der Aufrufer die beiden
  // Daten gar nicht erst vertauschen.
  const { tabellen, supabase } = umgebung();
  tabellen.invoices[0].due_date = "2024-11-14";

  const mahnung = await erstelleMahnung(supabase, CTX, params());

  assert.equal(mahnung.invoice_due_date, "2024-11-14");
  assert.equal(mahnung.default_since, "2024-11-30");
});

test("eine zweite gültige Fassung derselben Stufe wird abgewiesen", async () => {
  const { supabase } = umgebung();
  await erstelleMahnung(supabase, CTX, params());

  await assert.rejects(
    () => erstelleMahnung(supabase, CTX, params("2025-04-30")),
    (e: unknown) => e instanceof DunningServiceError && e.status === 409
  );
});

test("eine bezahlte Rechnung wird nicht mehr gemahnt", async () => {
  const { tabellen, supabase } = umgebung();
  tabellen.invoices[0].status = "paid";

  await assert.rejects(
    () => erstelleMahnung(supabase, CTX, params()),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
});

// ---------------------------------------------------------------------------
// 5. Ablösen
// ---------------------------------------------------------------------------

test("die abgelöste Fassung verliert ihre Gültigkeit, die neue bekommt sie", async () => {
  const { tabellen, supabase } = umgebung();
  const alt = await erstelleMahnung(supabase, CTX, params());
  // Nur eine verschickte Mahnung wird abgelöst.
  tabellen.payment_reminders[0].status = "sent";
  tabellen.payment_reminders[0].sent_at = "2025-03-31T12:00:00Z";

  const neu = await ersetzeMahnung(supabase, CTX, {
    ...params("2025-04-30"),
    abzuloesendeId: alt.id,
  });

  const verlauf = await ladeMahnungen(supabase, CTX, "inv-1");
  assert.equal(verlauf.length, 2, "die alte Fassung bleibt lesbar stehen");

  const alteFassung = verlauf.find((m) => m.id === alt.id)!;
  const neueFassung = verlauf.find((m) => m.id === neu.id)!;

  assert.equal(alteFassung.superseded_by, neu.id, "die alte zeigt auf ihre Nachfolgerin");
  assert.equal(neueFassung.superseded_by, null, "die neue ist die gültige Fassung");
  assert.equal(neueFassung.stage_position, alteFassung.stage_position);
  // Die neue Fassung rechnet über den längeren Zeitraum und fordert mehr.
  assert.ok((neueFassung.interest_amount as number) > (alteFassung.interest_amount as number));

  // Gegenprobe: Der Index, an dem sich die Reihenfolge bewährt hat, ist scharf.
  // Dieselbe Tabelle noch einmal mit der naiven Reihenfolge — erst die neue
  // Fassung als gültig einfügen, dann die alte abmelden — und schon schlägt er
  // zu. Ohne das Parken wäre der Ablauf oben nicht durchgekommen.
  assert.throws(
    () =>
      pruefeIndex([
        { id: "a", invoice_id: "inv-1", stage_position: 2, superseded_by: null },
        { id: "b", invoice_id: "inv-1", stage_position: 2, superseded_by: null },
      ]),
    (e: unknown) => (e as { code?: string }).code === "23505"
  );
  // Und als Gegenprobe zur Gegenprobe: Beim Parken — die neue Fassung zeigt auf
  // die alte — beanstandet derselbe Index nichts.
  assert.doesNotThrow(() =>
    pruefeIndex([
      { id: "a", invoice_id: "inv-1", stage_position: 2, superseded_by: null },
      { id: "b", invoice_id: "inv-1", stage_position: 2, superseded_by: "a" },
    ])
  );
});

test("eine noch nicht versendete Mahnung wird nicht abgelöst, sondern verworfen", async () => {
  const { supabase } = umgebung();
  const alt = await erstelleMahnung(supabase, CTX, params());

  await assert.rejects(
    () => ersetzeMahnung(supabase, CTX, { ...params("2025-04-30"), abzuloesendeId: alt.id }),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
});

test("abgelöst wird nur durch eine Fassung derselben Stufe", async () => {
  const { tabellen, supabase } = umgebung();
  const alt = await erstelleMahnung(supabase, CTX, params());
  tabellen.payment_reminders[0].status = "sent";
  tabellen.payment_reminders[0].sent_at = "2025-03-31T12:00:00Z";

  await assert.rejects(
    () =>
      ersetzeMahnung(supabase, CTX, {
        ...params("2025-04-30", DEFAULT_DUNNING_STAGES[2]),
        abzuloesendeId: alt.id,
      }),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
});

// ---------------------------------------------------------------------------
// 6. Verwerfen
// ---------------------------------------------------------------------------

test("das Verwerfen einer Korrektur macht die Vorgängerin wieder gültig", async () => {
  const { tabellen, supabase } = umgebung();
  const alt = await erstelleMahnung(supabase, CTX, params());
  tabellen.payment_reminders[0].status = "sent";
  tabellen.payment_reminders[0].sent_at = "2025-03-31T12:00:00Z";
  const neu = await ersetzeMahnung(supabase, CTX, {
    ...params("2025-04-30"),
    abzuloesendeId: alt.id,
  });

  await verwerfeMahnung(supabase, CTX, neu.id);

  const verlauf = await ladeMahnungen(supabase, CTX, "inv-1");
  assert.deepEqual(
    verlauf.map((m) => [m.id, m.superseded_by]),
    [[alt.id, null]],
    "ON DELETE SET NULL nimmt die Ablösung vollständig zurück"
  );
});

test("eine versendete Mahnung lässt sich nicht verwerfen", async () => {
  const { tabellen, supabase } = umgebung();
  const mahnung = await erstelleMahnung(supabase, CTX, params());
  tabellen.payment_reminders[0].status = "sent";
  tabellen.payment_reminders[0].sent_at = "2025-03-31T12:00:00Z";

  await assert.rejects(
    () => verwerfeMahnung(supabase, CTX, mahnung.id),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
  assert.equal(tabellen.payment_reminders.length, 1);
});
