import type { Address, BankDetails, Seller } from "./schema";
import type { InterestSegment } from "./dunning-interest";
import type { PartySnapshot, PaymentReminder } from "../types";
import { round2 } from "./invoice-totals";
import {
  briefbogenAnlegen,
  sanitizeParagraphs,
  zeichneFliesstext,
  zeichneFusszeileAufAllenSeiten,
  zeichneKopf,
  zeichneZweispalter,
  COLOR_BLACK,
  COLOR_GRAY,
  CONTENT_WIDTH,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  PAGE_WIDTH,
  type Metazeile,
} from "./pdf-briefbogen";
import {
  formatCurrencyForLanguage,
  formatDateForLanguage,
  type InvoiceLanguage,
} from "./invoice-translations";
import {
  baueMahnschreiben,
  formatPercentForLanguage,
  getMahnTexte,
  stufennameFuer,
} from "./reminder-text";

/**
 * Das Mahnschreiben als PDF.
 *
 * Es entsteht auf demselben Briefbogen wie die Rechnung
 * (`lib/pdf-briefbogen.ts`) — gleicher Kopf, gleicher Empfängerblock, gleiche
 * Fusszeile —, bleibt aber ein **einfaches** PDF. Vier Dinge gelten hier
 * anders als beim Rechnungs-PDF, und zwar zwingend:
 *
 *  1. **Keine Umsatzsteuerzeile.** Verzugszinsen und Mahnkosten sind
 *     Schadensersatz (§ 280, § 288 BGB) und kein Leistungsaustausch; es
 *     entsteht kein Umsatz, auf den Steuer anfiele. Wer sie trotzdem
 *     ausweist, schuldet sie nach § 14c UStG. Die Hauptforderung wiederum ist
 *     auf der Rechnung bereits versteuert und wird hier nur wiederholt.
 *     Deshalb trägt dieses Dokument **keinerlei** Steuerzeile, auch keine
 *     „0 %"-Zeile.
 *  2. **Keine Rechnungsnummer.** Eine Mahnung ist kein Beleg nach § 14 UStG
 *     und darf den fortlaufenden Rechnungskreis nicht anfassen. Das Schreiben
 *     nennt **nur** die Nummer der gemahnten Rechnung und bildet auch keine
 *     eigene Kennung daraus: eine zweite Nummer auf dem Blatt wäre genau die
 *     Verwechslung, die hier nicht entstehen darf.
 *  3. **Kein ZUGFeRD, kein XML.** EN 16931 kennt nur Rechnungsarten; eine
 *     Mahnung ist keine. `embedFacturX` bleibt deshalb aussen vor — das
 *     Ergebnis ist ein reines pdf-lib-Dokument.
 *  4. **Alles aus dem eingefrorenen Datensatz.** Kein Nachrechnen, kein
 *     „heute", kein Blick in die heutige Stufenkonfiguration. Eine Mahnung von
 *     vor zwei Jahren muss heute dasselbe Blatt ergeben — bis hin zum
 *     Stufennamen, der in `payment_reminders.stage_name` kopiert liegt.
 *
 * **Reihenfolge auf dem Blatt.** Brieftext, danach die Forderungsaufstellung
 * unter eigener Überschrift, danach die Bankverbindung. Die Aufstellung steht
 * bewusst *hinter* dem Text und nicht in seiner Mitte: `intro_text` ist ein
 * vom Nutzer frei bearbeiteter Brief, dessen innere Gliederung diese Datei
 * nicht kennt. Ein Einschub an geratener Stelle zerrisse ihn; als Block hinter
 * der Grussformel liest sich die Aufstellung wie die Anlage, die sie ist.
 */

/** Der eingefrorene Datensatz, so weit das Schreiben ihn braucht. */
export type MahnungFuerPdf = Pick<
  PaymentReminder,
  | "stage_position"
  | "stage_name"
  | "reminder_date"
  | "due_date"
  | "default_since"
  | "invoice_due_date"
  | "claimed_amount"
  | "fee_amount"
  | "late_fee_flat"
  | "interest_amount"
  | "interest_segments"
  | "interest_rate"
  | "interest_from"
  | "interest_days"
  | "total_amount"
  | "seller_snapshot"
  | "buyer_snapshot"
  | "language"
  | "intro_text"
>;

/**
 * Der Bezug auf die gemahnte Rechnung.
 *
 * Nummer und Datum stehen nicht auf `payment_reminders` — die Tabelle verweist
 * über `invoice_id`. Sie kommen deshalb vom Aufrufer, der die Rechnung ohnehin
 * geladen hat. Mehr als diese beiden Angaben braucht das Schreiben nicht:
 * alles andere ist im Mahnungsdatensatz eingefroren.
 */
export interface RechnungsBezug {
  nummer: string;
  /** ISO-Tag. */
  datum: string;
}

export interface MahnschreibenInput {
  mahnung: MahnungFuerPdf;
  rechnung: RechnungsBezug;
  /**
   * Das Logo der Firma, wie es **heute** aussieht — wie beim Rechnungs-PDF.
   * Es ist Briefpapier, keine Angabe über die Forderung.
   */
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// Snapshot -> Briefbogen
// ---------------------------------------------------------------------------

/**
 * Die Adresse aus einem Partei-Snapshot.
 *
 * Der Snapshot schreibt klein und ohne Binnenmajuskel (`streetnumber`, `zip`),
 * der Briefbogen erwartet die Form aus `lib/schema.ts`. Dieselbe Umsetzung
 * macht `lib/invoice-mapper.ts` für die Rechnung; sie steht hier noch einmal,
 * weil der Mapper eine vollständige Rechnungszeile verlangt und eine Mahnung
 * keine hat.
 */
function adresseAusSnapshot(snapshot: PartySnapshot): Address {
  const adresse = snapshot.address;
  return {
    street: adresse?.street ?? "",
    streetNumber: adresse?.streetnumber ?? "",
    addressLine2: adresse?.addressline2 || undefined,
    postalCode: adresse?.zip ?? "",
    city: adresse?.city ?? "",
    country: adresse?.country || "DE",
  };
}

function verkaeuferAusSnapshot(snapshot: PartySnapshot): Seller {
  return {
    name: snapshot.name,
    address: adresseAusSnapshot(snapshot),
    phoneNumber: snapshot.contact?.phone || undefined,
    email: snapshot.email || snapshot.contact?.email || undefined,
    taxNumber: snapshot.tax_id || undefined,
    vatId: snapshot.vat_id || undefined,
    contact: snapshot.contact
      ? {
          name: snapshot.contact.name,
          phone: snapshot.contact.phone,
          email: snapshot.contact.email,
        }
      : undefined,
    court: snapshot.court || undefined,
    registerNumber: snapshot.register_number || undefined,
    managingDirector: snapshot.managing_director || undefined,
  };
}

function bankAusSnapshot(snapshot: PartySnapshot): BankDetails | undefined {
  const bank = snapshot.bank_details;
  if (!bank?.iban) return undefined;
  return {
    iban: bank.iban,
    bankName: bank.bank_name || "",
    bic: bank.bic || undefined,
    accountHolder: bank.account_holder || undefined,
  };
}

// ---------------------------------------------------------------------------
// Zinsabschnitte
// ---------------------------------------------------------------------------

/**
 * Die Zinsabschnitte aus der JSON-Spalte, defensiv gelesen.
 *
 * `interest_segments` ist `Json` und damit für den Compiler beliebig. Was
 * nicht wie ein Abschnitt aussieht, wird übergangen statt zu werfen: ein
 * Schreiben ohne Zinserläuterung ist ärgerlich, ein Schreiben, das sich gar
 * nicht erzeugen lässt, ist schlimmer.
 */
function leseZinsabschnitte(roh: unknown): InterestSegment[] {
  if (!Array.isArray(roh)) return [];
  return roh.filter(
    (eintrag): eintrag is InterestSegment =>
      !!eintrag &&
      typeof eintrag === "object" &&
      typeof (eintrag as InterestSegment).ratePercent === "number" &&
      typeof (eintrag as InterestSegment).from === "string" &&
      typeof (eintrag as InterestSegment).to === "string"
  );
}

// ---------------------------------------------------------------------------
// Das Schreiben
// ---------------------------------------------------------------------------

export async function generateReminderPDF(input: MahnschreibenInput): Promise<Uint8Array> {
  const { mahnung, rechnung } = input;

  // `payment_reminders.language` ist eine freie Zeichenkette. Alles, was nicht
  // ausdrücklich Englisch ist, ist Deutsch — dieselbe Vorgabe wie in
  // `baueAusRechnung` (`invoice.language || 'de'`).
  const language: InvoiceLanguage = mahnung.language === "en" ? "en" : "de";
  const t = getMahnTexte(language);
  const tag = (iso: string) => formatDateForLanguage(iso, language);
  const geld = (betrag: number) => formatCurrencyForLanguage(betrag, language);
  const prozent = (wert: number) => formatPercentForLanguage(wert, language);

  const verkaeuferSnapshot = mahnung.seller_snapshot as PartySnapshot | null;
  const kaeuferSnapshot = mahnung.buyer_snapshot as PartySnapshot | null;

  // Ohne Parteien gibt es keinen Briefbogen. Wie in `berechneForderung` wird
  // geworfen statt ein halbes Dokument zu liefern: ein Schreiben ohne Absender
  // oder ohne Empfänger darf nicht versehentlich im Postausgang landen.
  if (!verkaeuferSnapshot) {
    throw new Error(
      "Das Mahnschreiben lässt sich nicht erzeugen: Zu dieser Mahnung ist kein Absender gespeichert."
    );
  }
  if (!kaeuferSnapshot) {
    throw new Error(
      "Das Mahnschreiben lässt sich nicht erzeugen: Zu dieser Mahnung ist kein Empfänger gespeichert."
    );
  }

  const verkaeufer = verkaeuferAusSnapshot(verkaeuferSnapshot);
  const bank = bankAusSnapshot(verkaeuferSnapshot);

  const bogen = await briefbogenAnlegen();
  const { doc, regular, bold } = bogen;
  const { drawText, drawTextRight, wrapText, ensureSpace } = bogen;

  // ===========================================
  // 1. Kopf: Absenderzeile und Logo
  // ===========================================

  await zeichneKopf(bogen, {
    absenderName: verkaeufer.name,
    absenderAdresse: verkaeufer.address,
    logoUrl: input.logoUrl,
  });

  // ===========================================
  // 2. Empfängerblock und Metadatenspalte
  // ===========================================

  const metazeilen: Metazeile[] = [
    { label: t.metaDatum, value: tag(mahnung.reminder_date) },
    { label: t.metaRechnung, value: rechnung.nummer },
    { label: t.metaRechnungsdatum, value: tag(rechnung.datum) },
    { label: t.metaZahlbarBis, value: tag(mahnung.due_date) },
    { label: t.metaAnsprechpartner, value: verkaeufer.contact?.name },
  ];

  zeichneZweispalter(bogen, {
    empfaengerName: kaeuferSnapshot.name,
    empfaengerAdresse: adresseAusSnapshot(kaeuferSnapshot),
    language,
    metazeilen,
  });

  // ===========================================
  // 3. Überschrift: der eingefrorene Stufenname
  // ===========================================

  // `stage_name` und nicht die heutige Konfiguration: Wird die Stufe später
  // umbenannt, bleibt dieses Schreiben, was es war. Übersetzt werden nur die
  // Standardnamen; ein selbstgewählter bleibt die Angabe des Nutzers.
  const titel = stufennameFuer(mahnung.stage_name, language);
  drawText(titel, MARGIN_LEFT, bogen.y, { font: bold, size: 14 });
  bogen.y -= 30;

  // Eine lange Mahnung läuft auf weitere Seiten, statt in die Fusszeile
  // hineinzuwachsen. Die Fortsetzungsseiten tragen einen kurzen Kopf.
  bogen.fortsetzungskopf = () => {
    drawText(t.fortsetzung(titel), MARGIN_LEFT, bogen.y, { size: 8, color: COLOR_GRAY });
    bogen.y -= 24;
  };

  // ===========================================
  // 4. Der Brieftext
  // ===========================================

  const hatZusaetze =
    mahnung.interest_amount > 0 || mahnung.fee_amount > 0 || mahnung.late_fee_flat > 0;

  // Der eingefrorene Text gewinnt. NULL heisst „kein Text hinterlegt" und wird
  // durch den vorbereiteten Standardtext ersetzt; eine leere Zeichenkette ist
  // dagegen die Entscheidung des Nutzers, kein Anschreiben zu drucken, und
  // wird respektiert.
  const brieftext =
    mahnung.intro_text ??
    baueMahnschreiben({
      stagePosition: mahnung.stage_position,
      rechnungsnummer: rechnung.nummer,
      rechnungsdatum: rechnung.datum,
      rechnungsFaelligkeit: mahnung.invoice_due_date,
      verzugSeit: mahnung.default_since,
      reminderDate: mahnung.reminder_date,
      zahlbarBis: mahnung.due_date,
      offenerBetrag: mahnung.claimed_amount,
      summe: mahnung.total_amount,
      hatZusaetze,
      absender: verkaeufer.name,
      language,
    });

  // Leerzeile trennt Absätze, ein einzelner Umbruch ist eine harte Zeile
  // innerhalb eines Absatzes — so, wie der Mahnen-Dialog den Text aufbaut.
  for (const block of brieftext
    .split(/\r?\n[ \t]*\r?\n/)
    .map((roh) => sanitizeParagraphs(roh))
    .filter((zeilen) => zeilen.length > 0)) {
    zeichneFliesstext(bogen, block, { umbruchSichern: true });
    bogen.y -= 8;
  }

  // Etwas mehr Luft als zwischen zwei Absätzen: Was jetzt folgt, ist nicht
  // mehr Brief, sondern Anlage.
  bogen.y -= 10;

  // ===========================================
  // 5. Forderungsaufstellung — nur wenn es etwas aufzustellen gibt
  // ===========================================

  // Bei einer reinen Zahlungserinnerung bestünde die Tabelle aus zwei Zeilen
  // mit derselben Zahl. Das behauptet eine Zusammensetzung, die es nicht gibt.
  if (hatZusaetze) {
    const labelBreite = CONTENT_WIDTH - 120;
    const wertX = PAGE_WIDTH - MARGIN_RIGHT;

    // Die Erläuterung zu den Zinsen, vorab umbrochen: ihre Zeilenzahl geht in
    // die Höhe des Blocks ein, und der Block soll nicht umbrechen.
    const erlaeuterung = zinsErlaeuterung(mahnung, { t, tag, geld, prozent }).flatMap((zeile) =>
      wrapText(zeile, CONTENT_WIDTH - 12, regular, 8)
    );

    const posten: Array<{ label: string; betrag: number }> = [
      { label: t.offenerBetrag, betrag: mahnung.claimed_amount },
    ];
    if (mahnung.interest_amount > 0) {
      posten.push({ label: t.zinsen, betrag: mahnung.interest_amount });
    }
    if (mahnung.fee_amount > 0) {
      posten.push({ label: t.mahnkosten, betrag: mahnung.fee_amount });
    }
    if (mahnung.late_fee_flat > 0) {
      posten.push({ label: t.pauschale, betrag: mahnung.late_fee_flat });
    }

    // Der ganze Block wird am Stück umbrochen. Eine Aufstellung, deren Summe
    // auf der nächsten Seite steht, ist keine Aufstellung mehr.
    const blockHoehe = 22 + posten.length * 16 + erlaeuterung.length * 10 + 12 + 18;
    ensureSpace(blockHoehe);

    drawText(t.aufstellung, MARGIN_LEFT, bogen.y, { font: bold, size: 10 });
    bogen.y -= 20;

    for (const zeile of posten) {
      drawText(zeile.label, MARGIN_LEFT, bogen.y, { maxWidth: labelBreite });
      drawTextRight(geld(zeile.betrag), wertX, bogen.y);
      bogen.y -= 16;

      // Die Erläuterung hängt unter ihrer Zeile.
      if (zeile.label === t.zinsen) {
        for (const erklaerung of erlaeuterung) {
          drawText(erklaerung, MARGIN_LEFT + 12, bogen.y, { size: 8, color: COLOR_GRAY });
          bogen.y -= 10;
        }
        if (erlaeuterung.length > 0) bogen.y -= 4;
      }
    }

    bogen.y += 2;
    bogen.page.drawLine({
      start: { x: MARGIN_LEFT, y: bogen.y },
      end: { x: wertX, y: bogen.y },
      thickness: 0.5,
      color: COLOR_BLACK,
    });
    bogen.y -= 14;

    drawText(t.gesamt, MARGIN_LEFT, bogen.y, { font: bold, maxWidth: labelBreite });
    drawTextRight(geld(mahnung.total_amount), wertX, bogen.y, { font: bold });
    bogen.y -= 24;
    bogen.blocksOnPage++;
  }

  // ===========================================
  // 6. Bankverbindung
  // ===========================================

  // Die Fusszeile trägt dieselben Angaben in 8 pt Grau als Briefkopf-Beiwerk.
  // Hier stehen sie noch einmal in Lesegrösse, samt Verwendungszweck: Dieses
  // Schreiben fordert zur Zahlung auf, und die Kontodaten sind sein eigentlicher
  // Zweck — sie gehören nicht ans Blattende zwischen Handelsregister und
  // Steuernummer.
  if (bank) {
    const zeilen: Array<{ label: string; wert: string }> = [];
    const kontoinhaber = bank.accountHolder?.trim();
    // Banken gleichen den Empfängernamen gegen die IBAN ab; weicht er von der
    // Firmierung ab, muss der Zahlende ihn sehen.
    if (kontoinhaber && kontoinhaber !== verkaeufer.name.trim()) {
      zeilen.push({ label: t.kontoinhaber, wert: kontoinhaber });
    }
    if (bank.bankName) zeilen.push({ label: t.bank, wert: bank.bankName });
    zeilen.push({ label: t.iban, wert: bank.iban });
    if (bank.bic) zeilen.push({ label: t.bic, wert: bank.bic });
    zeilen.push({
      label: t.verwendungszweck,
      wert: t.verwendungszweckWert(rechnung.nummer),
    });

    ensureSpace(20 + zeilen.length * 13);

    drawText(t.bankverbindung, MARGIN_LEFT, bogen.y, { font: bold, size: 10 });
    bogen.y -= 18;

    const wertX = MARGIN_LEFT + 110;
    for (const zeile of zeilen) {
      drawText(zeile.label, MARGIN_LEFT, bogen.y, { size: 9, color: COLOR_GRAY, maxWidth: 105 });
      drawText(zeile.wert, wertX, bogen.y, {
        size: 9,
        maxWidth: PAGE_WIDTH - MARGIN_RIGHT - wertX,
      });
      bogen.y -= 13;
    }
    bogen.blocksOnPage++;
  }

  // ===========================================
  // 7. Fusszeile auf allen Seiten
  // ===========================================

  zeichneFusszeileAufAllenSeiten(bogen, { seller: verkaeufer, bankDetails: bank, language });

  doc.setTitle(t.dokumentTitel(titel, rechnung.nummer));
  doc.setAuthor(verkaeufer.name);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  doc.setCreator("Invoice API");
  doc.setProducer("Invoice API");

  // Ein reines PDF. Kein `embedFacturX`: Es gibt kein XML, und nichts an
  // diesem Blatt behauptet, eine elektronische Rechnung zu sein.
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

// ---------------------------------------------------------------------------
// Die Zinserläuterung
// ---------------------------------------------------------------------------

interface ErlaeuterungsWerkzeug {
  t: ReturnType<typeof getMahnTexte>;
  tag: (iso: string) => string;
  geld: (betrag: number) => string;
  prozent: (wert: number) => string;
}

/**
 * Woher die Zinsen kommen — in Worten unter der Zinszeile.
 *
 * **Massgeblich sind die Abschnitte, nicht der Skalar.** Der Basiszinssatz
 * nach § 247 BGB ändert sich zum 1. Januar und zum 1. Juli; eine Forderung,
 * die über eine solche Grenze hinweg offen ist, trägt deshalb mehrere Sätze.
 * `payment_reminders.interest_rate` steht in diesem Fall mit gutem Grund auf
 * NULL (siehe `friereZinsgrundlagenEin`): der einzige Wert, der dort stehen
 * könnte, wäre `effectiveRate` — ein tagesgewichteter Durchschnitt, aus dem
 * sich der ausgewiesene Betrag nicht nachrechnen lässt. Ein einzelner
 * gemittelter Satz auf dem Schreiben wäre also eine Zahl, die aussieht wie
 * eine Feststellung und keine ist. Stattdessen wird jeder Abschnitt mit
 * seinem eigenen Satz, seinen Tagen und seinem Betrag genannt; die Beträge
 * addieren sich zum ausgewiesenen Zinsbetrag.
 *
 * Mehrere **Abschnitte** heissen dabei nicht automatisch mehrere **Sätze**:
 * `computeDefaultInterest` teilt auch an jedem Jahreswechsel, um den richtigen
 * Teiler (365/366) zu bekommen. Blieb der Satz dabei gleich, wird er als ein
 * Satz über den ganzen Zeitraum genannt.
 */
function zinsErlaeuterung(
  mahnung: MahnungFuerPdf,
  { t, tag, geld, prozent }: ErlaeuterungsWerkzeug
): string[] {
  if (mahnung.interest_amount <= 0) return [];

  const abschnitte = leseZinsabschnitte(mahnung.interest_segments);

  if (abschnitte.length > 0) {
    const saetze = new Set(abschnitte.map((a) => a.ratePercent));
    if (saetze.size === 1) {
      const erster = abschnitte[0];
      const letzter = abschnitte[abschnitte.length - 1];
      return [
        t.zinsEinSatz({
          satz: prozent(erster.ratePercent),
          aufschlag: prozent(round2(erster.ratePercent - erster.baseRate)),
          von: tag(erster.from),
          bis: tag(letzter.to),
          tage: abschnitte.reduce((summe, a) => summe + a.days, 0),
        }),
      ];
    }

    return [
      t.zinsMehrereUeberschrift,
      ...abschnitte.map((a) =>
        t.zinsAbschnitt({
          von: tag(a.from),
          bis: tag(a.to),
          satz: prozent(a.ratePercent),
          tage: a.days,
          betrag: geld(a.amount),
        })
      ),
    ];
  }

  // Rückfall auf die Skalare: ein Datensatz ohne Abschnitte (etwa aus einer
  // früheren Fassung des Schemas) kann trotzdem einen Satz tragen. Er steht
  // dort nur dann, wenn der ganze Zeitraum **einen** Satz hatte — ein
  // gemittelter Satz kann auf diesem Weg also gar nicht ins Schreiben geraten.
  if (mahnung.interest_rate !== null && mahnung.interest_from && mahnung.interest_days !== null) {
    return [
      t.zinsSkalar({
        satz: prozent(mahnung.interest_rate),
        von: tag(mahnung.interest_from),
        tage: mahnung.interest_days,
      }),
    ];
  }

  return [];
}
