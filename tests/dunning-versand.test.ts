import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WERKZEUGE,
  anhangname,
  baueMahnungsMail,
  erstelleMahnungMitSchreiben,
  naechsterRechnungsstatusNachMahnung,
  versendeMahnung,
  DunningServiceError,
  type MahnWerkzeuge,
} from "../lib/dunning-service";
import { berechneForderung, verzugsbeginn } from "../lib/dunning-claim";
import { DEFAULT_DUNNING_STAGES, type DunningStageDefinition } from "../lib/dunning-stages";
import type { Invoice, PartySnapshot } from "../types";
import type { SendEmailOptions } from "../lib/email";

/**
 * Der Weg einer Mahnung aus dem Haus — und was passiert, wenn er abbricht.
 *
 * Drei Zusicherungen stehen hier auf dem Spiel, und alle drei sind von der
 * Sorte, die man erst bemerkt, wenn sie fehlt:
 *
 *  1. **Keine Mahnung ohne Dokument.** Scheitert das PDF oder seine Ablage,
 *     darf keine Zeile zurückbleiben. Eine Mahnung, die man weder lesen noch
 *     verschicken kann, ist genau der Zustand, den diese Änderung abschafft.
 *  2. **Kein Rückfall im Rechnungsstatus.** Ein Mahnungsversand bewegt die
 *     Rechnung nur vorwärts. Eine bezahlte Rechnung, die durch das erneute
 *     Senden eines alten Schreibens wieder auf „gemahnt" spränge, erschiene
 *     wieder unter den offenen Forderungen.
 *  3. **`sent_at` ist der **erste** Versand.** An ihm hängen die Fristen
 *     dieser Stufe; eine Wiederholung darf ihn nicht nach hinten schieben.
 *
 * Die Außenwelt (PDF, Ablage, Mailversand) kommt als `MahnWerkzeuge` herein —
 * sonst liessen sich die Fehlschläge nicht herbeiführen, und der Test
 * verschickte echte E-Mails. Einmal wird dabei bewusst der **echte**
 * PDF-Erzeuger benutzt: Dass die Verdrahtung ein wirkliches PDF ablegt und
 * nicht irgendeinen Puffer, sagt kein Doppelgänger.
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
  bank_details: { bank_name: "Sparkasse", iban: "DE02100100100006820101", bic: "PBNKDEFF" },
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
    ...over,
  }) as unknown as Invoice;

const firma = () => ({
  id: "firma-1",
  name: "Blitz Handwerk",
  address: VERKAEUFER.address,
  bank_details: VERKAEUFER.bank_details,
  logo_url: null,
  email_settings: { mode: "default" },
  additional_contacts: [],
});

/** Die 1. Mahnung aus dem Standardsatz: Zinsen und 40-€-Pauschale. */
const STUFE_2 = DEFAULT_DUNNING_STAGES[1];
const STICHTAG = "2025-03-31";

function params(stufe: DunningStageDefinition = STUFE_2, inv = rechnung()) {
  return {
    invoiceId: inv.id,
    stufe,
    forderung: berechneForderung({
      invoice: inv,
      stufe,
      bisherigeMahnungen: [],
      customerType: "business" as const,
      verzugsbeginn: verzugsbeginn(inv),
      stichtag: STICHTAG,
    }),
    reminderDate: STICHTAG,
    defaultSince: verzugsbeginn(inv),
  };
}

// ---------------------------------------------------------------------------
// Ein Modell der Datenbank
// ---------------------------------------------------------------------------
//
// Dasselbe Vorgehen wie in `dunning-service.test.ts`, nur mit `update`: Die
// Mahnung bekommt ihr `pdf_url` nachgetragen, und der Versand schreibt Status
// und Zeitpunkt.


type Zeile = Record<string, any>;

const fehler = (code: string, message: string) => Object.assign(new Error(message), { code });

class Abfrage {
  private art: "select" | "insert" | "update" | "delete" = "select";
  private filter: Array<[string, unknown]> = [];
  private nutzlast: Zeile | null = null;

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
    this.nutzlast = zeile;
    return this;
  }
  update(zeile: Zeile) {
    this.art = "update";
    this.nutzlast = zeile;
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

  private lauf(): { data: unknown; error: unknown } {
    const zeilen = this.tabellen[this.tabelle];
    if (this.art === "insert") {
      const neu = {
        id: `pr-${zeilen.length + 1}`,
        pdf_url: null,
        sent_at: null,
        superseded_by: null,
        ...this.nutzlast,
      };
      zeilen.push(neu);
      return { data: [neu], error: null };
    }
    if (this.art === "update") {
      const betroffen = this.treffer();
      for (const z of betroffen) Object.assign(z, this.nutzlast);
      return { data: betroffen, error: null };
    }
    if (this.art === "delete") {
      const weg = this.treffer();
      for (const z of weg) zeilen.splice(zeilen.indexOf(z), 1);
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

  then<TErfuellt = { data: unknown; error: unknown }, TAbgelehnt = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => TErfuellt | PromiseLike<TErfuellt>) | null,
    onrejected?: ((reason: unknown) => TAbgelehnt | PromiseLike<TAbgelehnt>) | null
  ): PromiseLike<TErfuellt | TAbgelehnt> {
    return Promise.resolve(this.lauf()).then(onfulfilled, onrejected);
  }
}

function umgebung(inv: Invoice = rechnung()) {
  const tabellen: Record<string, Zeile[]> = {
    invoices: [inv as unknown as Zeile],
    companies: [firma()],
    payment_reminders: [],
  };

  const supabase = { from: (t: string) => new Abfrage(tabellen, t) } as any;
  return { tabellen, supabase };
}

const CTX = { companyId: "firma-1", userId: "nutzer-1" };

/** Werkzeuge, die alles mitschreiben und nichts nach draussen tun. */
function werkzeuge(over: Partial<MahnWerkzeuge> = {}) {
  const abgelegt: Array<{ dateiname: string; inhalt: Buffer }> = [];
  const versendet: SendEmailOptions[] = [];
  const w: MahnWerkzeuge = {
    erzeugeSchreiben: async () => new Uint8Array([1, 2, 3]),
    legeAb: async (_userId, _invoiceId, dateiname, inhalt) => {
      abgelegt.push({ dateiname, inhalt });
      return `https://ablage.example/${dateiname}`;
    },
    holeAb: async () => Buffer.from("PDF-INHALT"),
    verschicke: async (options) => {
      versendet.push(options);
    },
    ...over,
  };
  return { w, abgelegt, versendet };
}

// ---------------------------------------------------------------------------
// 1. Erstellen: entweder mit Dokument oder gar nicht
// ---------------------------------------------------------------------------

test("erstelleMahnungMitSchreiben legt das PDF ab und trägt es ein", async () => {
  const { supabase, tabellen } = umgebung();
  const { w, abgelegt } = werkzeuge();

  const mahnung = await erstelleMahnungMitSchreiben(supabase, CTX, params(), w);

  assert.equal(abgelegt.length, 1);
  assert.equal(mahnung.pdf_url, `https://ablage.example/${abgelegt[0].dateiname}`);
  // Die Kennung steckt im Dateinamen: Eine abgelöste Fassung derselben Stufe
  // liegt daneben und darf nicht überschrieben werden.
  assert.match(abgelegt[0].dateiname, new RegExp(`^Mahnung-${STUFE_2.position}-${mahnung.id}\\.pdf$`));

  // Und die Zeile in der Datenbank trägt ihn auch — nicht nur der Rückgabewert.
  assert.equal(tabellen.payment_reminders[0].pdf_url, mahnung.pdf_url);
  assert.equal(tabellen.payment_reminders[0].status, "created");
  assert.equal(tabellen.payment_reminders[0].sent_at, null);
});

test("das abgelegte Dokument ist ein echtes PDF", async () => {
  // Einmal mit dem richtigen Erzeuger: Dass die Verdrahtung ein PDF ablegt
  // und nicht irgendeinen Puffer, kann nur der echte Weg zeigen.
  const { supabase } = umgebung();
  const { w, abgelegt } = werkzeuge({ erzeugeSchreiben: WERKZEUGE.erzeugeSchreiben });

  await erstelleMahnungMitSchreiben(supabase, CTX, params(), w);

  assert.equal(abgelegt[0].inhalt.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(abgelegt[0].inhalt.length > 1000, "ein leeres Blatt wäre kein Schreiben");
});

test("scheitert das PDF, bleibt keine Mahnung zurück", async () => {
  const { supabase, tabellen } = umgebung();
  const { w } = werkzeuge({
    erzeugeSchreiben: async () => {
      throw new Error("Zu dieser Mahnung ist kein Absender gespeichert.");
    },
  });

  await assert.rejects(
    () => erstelleMahnungMitSchreiben(supabase, CTX, params(), w),
    (e: unknown) =>
      e instanceof DunningServiceError &&
      e.status === 500 &&
      // Der Grund des Erzeugers wird durchgereicht: Er sagt dem Nutzer, was
      // ihm fehlt, und „Serverfehler" sagt das nicht.
      e.message.includes("kein Absender")
  );

  assert.equal(tabellen.payment_reminders.length, 0, "die angelegte Zeile muss wieder weg sein");
});

test("scheitert die Ablage, bleibt ebenfalls keine Mahnung zurück", async () => {
  const { supabase, tabellen } = umgebung();
  const { w } = werkzeuge({
    legeAb: async () => {
      throw new Error("S3 nicht erreichbar");
    },
  });

  await assert.rejects(
    () => erstelleMahnungMitSchreiben(supabase, CTX, params(), w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 500
  );
  assert.equal(tabellen.payment_reminders.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Versenden
// ---------------------------------------------------------------------------

async function mitMahnung(inv: Invoice = rechnung()) {
  const umg = umgebung(inv);
  const { w, versendet } = werkzeuge();
  const mahnung = await erstelleMahnungMitSchreiben(umg.supabase, CTX, params(STUFE_2, inv), w);
  return { ...umg, mahnung, versendet, w };
}

test("versendeMahnung hängt das Schreiben an und hebt die Rechnung auf reminded", async () => {
  const { supabase, tabellen, mahnung, versendet, w } = await mitMahnung();

  const ergebnis = await versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w);

  assert.equal(ergebnis.empfaengerEmail, KAEUFER.email);
  assert.equal(ergebnis.erneut, false);
  assert.equal(ergebnis.rechnungsStatus, "reminded");

  // Die E-Mail: ein Anhang, und zwar das Mahnschreiben als PDF.
  assert.equal(versendet.length, 1);
  const mail = versendet[0];
  assert.equal(mail.to, KAEUFER.email);
  assert.equal(mail.attachments?.length, 1);
  assert.equal(mail.attachments![0].contentType, "application/pdf");
  assert.equal(mail.attachments![0].name, `${STUFE_2.name} INV-0007.pdf`);
  assert.equal(
    Buffer.from(mail.attachments![0].content, "base64").toString(),
    "PDF-INHALT",
    "angehängt wird die abgelegte Datei, nicht ein neu erzeugtes Blatt"
  );
  // Der Brief steht im PDF, nicht in der Mail: Die Mail nennt nur Anhang und
  // Frist, keine Forderungsaufstellung.
  assert.ok(mail.textBody!.includes(STUFE_2.name));
  assert.equal(mail.textBody!.includes("Verzugszinsen"), false);

  // Und der Zustand danach.
  const gespeichert = tabellen.payment_reminders[0];
  assert.equal(gespeichert.status, "sent");
  assert.ok(gespeichert.sent_at, "was als verschickt gilt, muss sagen wann");
  assert.equal(gespeichert.recipient_email, KAEUFER.email);
  assert.equal(tabellen.invoices[0].status, "reminded");
});

/**
 * Rückfall: Mahnungen gingen an die alte Adresse, obwohl in der Schublade
 * eine neue gespeichert war.
 *
 * Zwei Ursachen, die sich gegenseitig deckten. Die Schublade lud nach dem
 * Speichern den Mahnstatus nicht nach, hielt also einen Schnappschuss vom
 * Öffnen fest — und die Achse schickte die Adresse aus diesem Schnappschuss
 * beim Versand mit. Hier gewinnt eine mitgeschickte Adresse über jede
 * hinterlegte, und damit gewann der veraltete Wert.
 *
 * Die Oberfläche schickt jetzt nichts mehr mit, was sie nicht anzeigt. Diese
 * beiden Prüfungen halten die Rangfolge fest, auf die sie sich dabei verlässt.
 */
test("ohne mitgeschickte Adresse gewinnt die der Rechnung über den Empfänger-Snapshot", async () => {
  const inv = rechnung({ recipient_email: "buchhaltung@kunde.test" } as Partial<Invoice>);
  const { supabase, tabellen, mahnung, versendet, w } = await mitMahnung(inv);

  const ergebnis = await versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w);

  assert.equal(ergebnis.empfaengerEmail, "buchhaltung@kunde.test");
  assert.equal(versendet[0].to, "buchhaltung@kunde.test");
  assert.notEqual(ergebnis.empfaengerEmail, KAEUFER.email);
  // Schon beim Anlegen festgehalten, nicht erst beim Senden aufgelöst: Woran
  // das Schreiben adressiert war, soll später nachlesbar sein.
  assert.equal(tabellen.payment_reminders[0].recipient_email, "buchhaltung@kunde.test");
});

test("eine ausdrücklich mitgeschickte Adresse schlägt die hinterlegte", async () => {
  const inv = rechnung({ recipient_email: "buchhaltung@kunde.test" } as Partial<Invoice>);
  const { supabase, mahnung, versendet, w } = await mitMahnung(inv);

  // Das ist der Fall „Vorher ansehen": Dort steht das Feld, der Benutzer sieht
  // es und ändert es für diesen einen Versand. Nur dann darf es gewinnen.
  const ergebnis = await versendeMahnung(
    supabase,
    { companyId: "firma-1" },
    { reminderId: mahnung.id, recipientEmail: "chef@kunde.test" },
    w
  );

  assert.equal(ergebnis.empfaengerEmail, "chef@kunde.test");
  assert.equal(versendet[0].to, "chef@kunde.test");
});

test("erneutes Senden ist erlaubt und lässt sent_at stehen", async () => {
  const { supabase, tabellen, mahnung, versendet, w } = await mitMahnung();
  const ctx = { companyId: "firma-1" };

  await versendeMahnung(supabase, ctx, { reminderId: mahnung.id }, w);
  const ersterVersand = tabellen.payment_reminders[0].sent_at;

  const zweites = await versendeMahnung(supabase, ctx, { reminderId: mahnung.id }, w);

  assert.equal(zweites.erneut, true);
  assert.equal(versendet.length, 2, "die zweite E-Mail geht tatsächlich hinaus");
  // Der Tag des ersten Versands trägt die Fristen dieser Stufe. Ihn auf die
  // Wiederholung zu setzen machte die eigene Mahnung jünger, als sie ist.
  assert.equal(tabellen.payment_reminders[0].sent_at, ersterVersand);
});

test("eine bezahlte Rechnung wird durch einen Mahnungsversand nicht zurückgesetzt", async () => {
  const { supabase, tabellen, mahnung, w } = await mitMahnung();
  const ctx = { companyId: "firma-1" };

  await versendeMahnung(supabase, ctx, { reminderId: mahnung.id }, w);
  assert.equal(tabellen.invoices[0].status, "reminded");

  // Der Kunde zahlt — und jemand schickt das Schreiben als Beleg noch einmal.
  tabellen.invoices[0].status = "paid";
  await assert.rejects(
    () => versendeMahnung(supabase, ctx, { reminderId: mahnung.id }, w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400,
    "eine bezahlte Forderung wird gar nicht mehr gemahnt"
  );
  assert.equal(tabellen.invoices[0].status, "paid");
});

test("der Rechnungsstatus bewegt sich nur vorwärts", () => {
  // Dieselbe Regel wie `nextStatusAfterSend`, nur eine Station weiter.
  assert.equal(naechsterRechnungsstatusNachMahnung("created"), "reminded");
  assert.equal(naechsterRechnungsstatusNachMahnung("sent"), "reminded");
  for (const status of ["reminded", "paid", "cancelled", "uneinbringlich", "draft"]) {
    assert.equal(naechsterRechnungsstatusNachMahnung(status), null, status);
  }
});

test("eine abgelöste Fassung wird nicht mehr verschickt", async () => {
  const { supabase, tabellen, mahnung, w } = await mitMahnung();
  tabellen.payment_reminders[0].superseded_by = "pr-99";

  await assert.rejects(
    () => versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 409
  );
});

test("eine Mahnung ohne Schreiben lässt sich nicht verschicken", async () => {
  // Der Bestand aus der Zeit vor der Erzeugung. Eine Mahn-E-Mail ohne Mahnung
  // im Anhang wäre keine.
  const { supabase, tabellen, mahnung, w } = await mitMahnung();
  tabellen.payment_reminders[0].pdf_url = null;

  await assert.rejects(
    () => versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
});

test("ohne Empfängeradresse wird nicht verschickt", async () => {
  const ohneAdresse = rechnung({
    buyer_snapshot: { ...KAEUFER, email: undefined } as unknown as Invoice["buyer_snapshot"],
  });
  const { supabase, mahnung, w, versendet } = await mitMahnung(ohneAdresse);

  await assert.rejects(
    () => versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 400
  );
  assert.equal(versendet.length, 0);
});

test("der Versand scheitert, ohne das Dokument mitzunehmen", async () => {
  // Die Gegenprobe zum Erstellen: Dort wird zurückgenommen, hier nicht. Ein
  // erzeugtes Schreiben ist nicht verloren, nur weil das Postfach des
  // Empfängers nicht erreichbar war — es lässt sich erneut senden.
  const { supabase, tabellen, mahnung } = await mitMahnung();
  const { w } = werkzeuge({
    verschicke: async () => {
      throw new Error("Postfach nicht erreichbar");
    },
  });

  await assert.rejects(
    () => versendeMahnung(supabase, { companyId: "firma-1" }, { reminderId: mahnung.id }, w),
    (e: unknown) => e instanceof DunningServiceError && e.status === 500
  );

  assert.equal(tabellen.payment_reminders.length, 1);
  assert.equal(tabellen.payment_reminders[0].pdf_url, mahnung.pdf_url);
  assert.equal(tabellen.payment_reminders[0].status, "created", "nicht als verschickt vermerkt");
  assert.equal(tabellen.invoices[0].status, "sent", "und die Rechnung ist nicht gemahnt");
});

test("ein bearbeiteter E-Mail-Text gewinnt, auch wenn er leer ist", async () => {
  const { supabase, mahnung, versendet, w } = await mitMahnung();

  await versendeMahnung(
    supabase,
    { companyId: "firma-1" },
    { reminderId: mahnung.id, subject: "Bitte um Zahlung", body: "" },
    w
  );

  assert.equal(versendet[0].subject, "Bitte um Zahlung");
  // Wer alles löscht, will keine Begleitzeilen — das Schreiben hängt ja an.
  assert.equal(versendet[0].textBody, "");
});

// ---------------------------------------------------------------------------
// 3. Die beiden Texte
// ---------------------------------------------------------------------------

test("die Begleit-E-Mail nennt Anhang, Betrag und Frist — und sonst nichts", () => {
  const { betreff, text } = baueMahnungsMail(
    { stage_name: "1. Mahnung", due_date: "2025-04-14", total_amount: 1234.5, language: "de" },
    "INV-0007",
    "Blitz Handwerk"
  );

  assert.equal(betreff, "1. Mahnung – Rechnung INV-0007");
  assert.ok(text.includes("1.234,50"));
  assert.ok(text.includes("14.04.2025"));
  assert.ok(text.includes("Anhang"));
  assert.ok(text.endsWith("Blitz Handwerk"));
  // Keine zweite Fassung der Forderung: Was sie ausmacht, steht im Schreiben.
  for (const wort of ["Verzugszinsen", "Pauschale", "§"]) {
    assert.equal(text.includes(wort), false, wort);
  }
});

test("eine englische Mahnung bekommt eine englische Begleit-E-Mail", () => {
  const { betreff, text } = baueMahnungsMail(
    { stage_name: "Reminder", due_date: "2025-04-14", total_amount: 1234.5, language: "en" },
    "INV-0007",
    "Blitz Handwerk"
  );

  assert.ok(betreff.includes("invoice INV-0007"));
  assert.ok(text.startsWith("Dear Sir or Madam,"));
  // Eine deutsche Mail zu einem englischen Schreiben wäre ein halber Vorgang.
  assert.equal(text.includes("Sehr geehrte"), false);
});

test("der Anhangname ist lesbar und enthält nichts, was Dateinamen bricht", () => {
  assert.equal(anhangname("1. Mahnung", "INV-0007"), "1. Mahnung INV-0007.pdf");
  // Ein selbstgewählter Stufenname darf alles enthalten; der Dateiname nicht.
  assert.equal(anhangname("Letzte Mahnung / Inkasso", "RE:1"), "Letzte Mahnung - Inkasso RE-1.pdf");
  assert.equal(anhangname("Zahlungserinnerung", null), "Zahlungserinnerung.pdf");
});
