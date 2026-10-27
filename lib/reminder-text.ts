import {
  formatCurrencyForLanguage,
  formatDateForLanguage,
  type InvoiceLanguage,
} from "./invoice-translations";

/**
 * Die Wörter des Mahnschreibens: Beschriftungen und der vorbereitete Brieftext.
 *
 * Warum eine eigene Datei und nicht `lib/invoice-translations.ts`:
 *
 *  * Eine Mahnung ist kein Rechnungsbeleg. Die dortige Tabelle beschriftet
 *    Positionen, Steuersätze und Summenblöcke — nichts davon kommt hier vor,
 *    und das soll auch so bleiben (siehe Kopfkommentar von
 *    `lib/reminder-pdf.ts`).
 *  * Diese Datei zieht bewusst **kein** pdf-lib herein. Die Mahnen-Schublade
 *    (`components/invoices/dunning-drawer.tsx`) bezieht ihren Brieftext von
 *    hier, ohne dass eine Client-Komponente den PDF-Erzeuger mitlädt.
 *
 * Alles hier ist reine Textbildung: keine Datenbank, kein „heute". Jede Angabe
 * kommt aus dem eingefrorenen Mahnungsdatensatz, damit dieselbe Mahnung in
 * zwei Jahren dasselbe Blatt ergibt.
 */

/** Prozentangabe mit zwei Nachkommastellen in der jeweiligen Schreibweise. */
export function formatPercentForLanguage(wert: number, language: InvoiceLanguage): string {
  return wert.toLocaleString(language === "en" ? "en-US" : "de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Ein Zinsabschnitt, so wie ihn die Erläuterung braucht. */
export interface ZinsAbschnittText {
  von: string;
  bis: string;
  /** Zinssatz in Prozent, bereits formatiert. */
  satz: string;
  tage: number;
  /** Betrag dieses Abschnitts, bereits formatiert. */
  betrag: string;
}

export interface MahnTexte {
  /** Beschriftungen der rechten Metadatenspalte. */
  metaDatum: string;
  metaRechnung: string;
  metaRechnungsdatum: string;
  metaZahlbarBis: string;
  metaAnsprechpartner: string;

  /** Kopfzeile der Fortsetzungsseiten. */
  fortsetzung: (titel: string) => string;

  /** Überschrift und Zeilen der Forderungsaufstellung. */
  aufstellung: string;
  offenerBetrag: string;
  zinsen: string;
  mahnkosten: string;
  pauschale: string;
  gesamt: string;

  /** Erläuterung unter der Zinszeile. */
  zinsEinSatz: (a: { satz: string; aufschlag: string; von: string; bis: string; tage: number }) => string;
  zinsMehrereUeberschrift: string;
  zinsAbschnitt: (a: ZinsAbschnittText) => string;
  /** Rückfall für Datensätze ohne Abschnitte — nur Satz, Beginn und Tage. */
  zinsSkalar: (a: { satz: string; von: string; tage: number }) => string;

  /** Der Zahlblock. */
  bankverbindung: string;
  kontoinhaber: string;
  bank: string;
  iban: string;
  bic: string;
  verwendungszweck: string;
  verwendungszweckWert: (rechnungsnummer: string) => string;

  /** Titel in den Dokumenteigenschaften. */
  dokumentTitel: (stufenname: string, rechnungsnummer: string) => string;
}

const deutsch: MahnTexte = {
  metaDatum: "DATUM",
  // Bewusst nicht „RECHNUNGS-NR." wie auf der Rechnung: Diese Zeile nennt die
  // **gemahnte** Rechnung. Die Mahnung selbst trägt keine Nummer, und die
  // Beschriftung des Rechnungsformulars an dieser Stelle legte das Gegenteil
  // nahe.
  metaRechnung: "RECHNUNG",
  metaRechnungsdatum: "RECHNUNGSDATUM",
  metaZahlbarBis: "ZAHLBAR BIS",
  metaAnsprechpartner: "IHR ANSPRECHPARTNER",

  fortsetzung: (titel) => `${titel} - Fortsetzung`,

  aufstellung: "Forderungsaufstellung",
  offenerBetrag: "Offener Betrag",
  zinsen: "Verzugszinsen",
  mahnkosten: "Mahnkosten",
  pauschale: "Pauschale nach § 288 Abs. 5 BGB",
  gesamt: "Gesamtforderung",

  zinsEinSatz: ({ satz, aufschlag, von, bis, tage }) =>
    `${satz} % p. a. (${aufschlag} Prozentpunkte über dem Basiszinssatz), ${von} bis ${bis}, ${tage} ${tage === 1 ? "Tag" : "Tage"}`,
  zinsMehrereUeberschrift: "Der Basiszinssatz hat sich im Verzugszeitraum geändert:",
  zinsAbschnitt: ({ von, bis, satz, tage, betrag }) =>
    `${von} bis ${bis}: ${satz} % p. a., ${tage} ${tage === 1 ? "Tag" : "Tage"}, ${betrag}`,
  zinsSkalar: ({ satz, von, tage }) =>
    `${satz} % p. a., seit ${von}, ${tage} ${tage === 1 ? "Tag" : "Tage"}`,

  bankverbindung: "Bankverbindung",
  kontoinhaber: "Kontoinhaber",
  bank: "Bank",
  iban: "IBAN",
  bic: "BIC",
  verwendungszweck: "Verwendungszweck",
  verwendungszweckWert: (nummer) => `Rechnung ${nummer}`,

  dokumentTitel: (stufenname, nummer) => `${stufenname} zu Rechnung ${nummer}`,
};

const englisch: MahnTexte = {
  metaDatum: "DATE",
  metaRechnung: "INVOICE",
  metaRechnungsdatum: "INVOICE DATE",
  metaZahlbarBis: "PAY BY",
  metaAnsprechpartner: "YOUR CONTACT",

  fortsetzung: (titel) => `${titel} - continued`,

  aufstellung: "Breakdown of the amount due",
  offenerBetrag: "Outstanding amount",
  zinsen: "Default interest",
  mahnkosten: "Reminder costs",
  pauschale: "Flat compensation (§ 288 (5) BGB)",
  gesamt: "Total due",

  zinsEinSatz: ({ satz, aufschlag, von, bis, tage }) =>
    `${satz} % p. a. (${aufschlag} percentage points above the base rate), ${von} to ${bis}, ${tage} ${tage === 1 ? "day" : "days"}`,
  zinsMehrereUeberschrift: "The base rate changed during the period of default:",
  zinsAbschnitt: ({ von, bis, satz, tage, betrag }) =>
    `${von} to ${bis}: ${satz} % p. a., ${tage} ${tage === 1 ? "day" : "days"}, ${betrag}`,
  zinsSkalar: ({ satz, von, tage }) =>
    `${satz} % p. a., since ${von}, ${tage} ${tage === 1 ? "day" : "days"}`,

  bankverbindung: "Bank details",
  kontoinhaber: "Account holder",
  bank: "Bank",
  iban: "IBAN",
  bic: "BIC",
  verwendungszweck: "Reference",
  verwendungszweckWert: (nummer) => `Invoice ${nummer}`,

  dokumentTitel: (stufenname, nummer) => `${stufenname} - invoice ${nummer}`,
};

export function getMahnTexte(language: InvoiceLanguage): MahnTexte {
  return language === "en" ? englisch : deutsch;
}

/**
 * Die drei Standardstufen (`DEFAULT_DUNNING_STAGES`) auf Englisch.
 *
 * Nach dem Namen, nicht nach der Position: Ein selbstgewählter Name ist die
 * Angabe des Nutzers und bleibt, wie er ist — eine erfundene Übersetzung wäre
 * schlechter als die Bezeichnung selbst. Die Standardnamen dagegen hat niemand
 * gewählt; ein „Zahlungserinnerung" mitten in einer englischen Mahnung ist
 * schlicht ein Fehler.
 */
const STANDARD_STUFEN_EN: Record<string, string> = {
  Zahlungserinnerung: "Payment reminder",
  "1. Mahnung": "First reminder",
  "Letzte Mahnung": "Final reminder",
};

/**
 * Der Stufenname in der Sprache des Schreibens. Übersetzt wird beim Ausgeben,
 * nicht beim Einfrieren — so werden auch bereits angelegte Mahnungen richtig.
 */
export function stufennameFuer(stageName: string, language: InvoiceLanguage): string {
  return language === "en" ? STANDARD_STUFEN_EN[stageName] ?? stageName : stageName;
}

// ---------------------------------------------------------------------------
// Der vorbereitete Brieftext
// ---------------------------------------------------------------------------

export interface MahnschreibenTextInput {
  /** Eskalationsstufe. Bestimmt den Ton, nicht die Beträge. */
  stagePosition: number;
  rechnungsnummer: string;
  /** ISO-Tag der gemahnten Rechnung. */
  rechnungsdatum: string;
  /** `invoices.due_date`, eingefroren. `null`, wenn die Rechnung keine trägt. */
  rechnungsFaelligkeit: string | null;
  /** Verzugsbeginn (`default_since`), einschliesslich 30-Tage-Boden. */
  verzugSeit: string;
  /** Datum des Schreibens. */
  reminderDate: string;
  /** Die Frist, die dieses Schreiben einräumt (`payment_reminders.due_date`). */
  zahlbarBis: string;
  /** Hauptforderung, eingefroren. */
  offenerBetrag: number;
  /** Gesamtforderung, eingefroren. */
  summe: number;
  /** Gibt es Nebenforderungen? Entscheidet nur über die Wortwahl. */
  hatZusaetze: boolean;
  /** Name der eigenen Firma — die Unterschrift unter dem Schreiben. */
  absender: string;
  language: InvoiceLanguage;
}

/**
 * Der Standardtext, wenn im Datensatz keiner eingefroren ist.
 *
 * Die Stufe bestimmt den Ton: Eine Zahlungserinnerung unterstellt ein
 * Versehen, eine Mahnung stellt den Verzug fest, die letzte nennt die Folge.
 *
 * **Keine Aufstellung im Text.** Die Beträge stehen im PDF in einer eigenen
 * Tabelle; sie hier zusätzlich aufzuzählen, druckte jede Zahl zweimal.
 *
 * **Vor Fälligkeit ein einziger, freundlicher Einstieg** — unabhängig von der
 * Stufe. Eine Eskalation setzt voraus, dass etwas ausgeblieben ist; bis zum
 * Fälligkeitstag ist nichts ausgeblieben. Dieselbe Unterscheidung trifft der
 * Mahnen-Dialog, nur dort gegen „heute"; hier gegen das eingefrorene
 * Schreibdatum, damit das Blatt reproduzierbar bleibt.
 */
export function baueMahnschreiben(input: MahnschreibenTextInput): string {
  const {
    stagePosition,
    rechnungsnummer,
    rechnungsdatum,
    rechnungsFaelligkeit,
    verzugSeit,
    reminderDate,
    zahlbarBis,
    offenerBetrag,
    summe,
    hatZusaetze,
    absender,
    language,
  } = input;

  const tag = (iso: string) => formatDateForLanguage(iso, language);
  const geld = (betrag: number) => formatCurrencyForLanguage(betrag, language);

  // Das Schreiben ging raus, bevor die Rechnung fällig wurde. Rein aus
  // eingefrorenen Werten bestimmt, nicht aus dem Kalender.
  const vorFaelligkeit =
    rechnungsFaelligkeit !== null && rechnungsFaelligkeit > reminderDate
      ? rechnungsFaelligkeit
      : null;

  // Fällig ist die Rechnung an ihrem eigenen Termin, nicht am Verzugsbeginn:
  // die beiden fallen auseinander, sobald der 30-Tage-Boden aus § 286 Abs. 3
  // BGB greift. Nur wenn die Rechnung gar keinen Termin trägt, bleibt der
  // Verzugsbeginn als Ersatz.
  const faelligkeit = rechnungsFaelligkeit ?? verzugSeit;

  if (language === "en") {
    const einstieg = vorFaelligkeit
      ? `our invoice ${rechnungsnummer} dated ${tag(rechnungsdatum)} for ${geld(offenerBetrag)} falls due on ${tag(vorFaelligkeit)}. This letter is a friendly advance reminder.`
      : stagePosition === 1
        ? `our invoice ${rechnungsnummer} dated ${tag(rechnungsdatum)} for ${geld(offenerBetrag)} fell due for payment on ${tag(faelligkeit)} and has not yet reached us. It may simply have been overlooked.`
        : stagePosition === 2
          ? `despite our payment reminder, our invoice ${rechnungsnummer} dated ${tag(rechnungsdatum)} for ${geld(offenerBetrag)} is still outstanding. You have been in default since ${tag(verzugSeit)}.`
          : `you have not responded to our previous letters. Our invoice ${rechnungsnummer} dated ${tag(rechnungsdatum)} for ${geld(offenerBetrag)} remains outstanding; you have been in default since ${tag(verzugSeit)}.`;

    const bitte = `Please transfer ${hatZusaetze ? "the total of" : "the amount of"} ${geld(summe)} to the account shown below by ${tag(zahlbarBis)}.`;

    const folge =
      stagePosition >= 3 && !vorFaelligkeit
        ? "If payment is not received by then, we will pass the claim on for legal enforcement without further notice."
        : null;

    return [
      "Dear Sir or Madam,",
      einstieg,
      bitte,
      folge,
      "If your payment has crossed with this letter, please disregard it.",
      `Kind regards\n${absender}`,
    ]
      .filter((absatz): absatz is string => absatz !== null)
      .join("\n\n");
  }

  const einstieg = vorFaelligkeit
    ? `unsere Rechnung ${rechnungsnummer} vom ${tag(rechnungsdatum)} über ${geld(offenerBetrag)} wird am ${tag(vorFaelligkeit)} fällig. Mit diesem Schreiben möchten wir Sie vorab freundlich daran erinnern.`
    : stagePosition === 1
      ? `unsere Rechnung ${rechnungsnummer} vom ${tag(rechnungsdatum)} über ${geld(offenerBetrag)} war am ${tag(faelligkeit)} zur Zahlung fällig und ist bei uns noch nicht eingegangen. Vermutlich ist sie in Ihrem Haus untergegangen.`
      : stagePosition === 2
        ? `trotz unserer Zahlungserinnerung ist unsere Rechnung ${rechnungsnummer} vom ${tag(rechnungsdatum)} über ${geld(offenerBetrag)} bis heute nicht ausgeglichen. Sie befinden sich seit dem ${tag(verzugSeit)} in Verzug.`
        : `auf unsere bisherigen Schreiben haben Sie nicht reagiert. Unsere Rechnung ${rechnungsnummer} vom ${tag(rechnungsdatum)} über ${geld(offenerBetrag)} ist weiterhin offen; Sie befinden sich seit dem ${tag(verzugSeit)} in Verzug.`;

  const bitte = `Wir bitten Sie, ${hatZusaetze ? "den Gesamtbetrag von" : "den Betrag von"} ${geld(summe)} bis zum ${tag(zahlbarBis)} auf das unten genannte Konto zu überweisen.`;

  // Die Ankündigung des gerichtlichen Schritts setzt voraus, dass die Zahlung
  // überhaupt schon geschuldet ist.
  const folge =
    stagePosition >= 3 && !vorFaelligkeit
      ? "Geht die Zahlung bis dahin nicht ein, geben wir die Forderung ohne weitere Ankündigung zur gerichtlichen Geltendmachung ab."
      : null;

  return [
    "Sehr geehrte Damen und Herren,",
    einstieg,
    bitte,
    folge,
    // Kostet eine Zeile und erspart dem Empfänger, der gestern überwiesen hat,
    // den Anruf.
    "Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.",
    `Mit freundlichen Grüßen\n${absender}`,
  ]
    .filter((absatz): absatz is string => absatz !== null)
    .join("\n\n");
}
