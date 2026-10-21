import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createHash } from "node:crypto";
import { generateInvoicePDF } from "../lib/pdf-generator";
import { makeInvoice } from "./helpers";
import type { Invoice, InvoiceItem } from "../lib/schema";
import type { InvoiceLanguage } from "../lib/invoice-translations";

/**
 * Messapparat und Fälle für den Charakterisierungstest des Rechnungs-PDFs.
 *
 * Bewusst keine `.test.ts`-Datei: der Testlauf (`tests/*.test.ts`) soll sie
 * nicht als eigene Suite aufsammeln. Sie liegt nur getrennt, damit die
 * erwarteten Konstanten in der Testdatei für sich stehen und die Messung bei
 * einer gewollten Layoutänderung aus genau einer Quelle neu erhoben wird.
 *
 * WOMIT WIR VERGLEICHEN — und warum nicht mit den Dateibytes:
 *
 * Die rohen Bytes taugen nicht. `embedFacturX` schreibt `xmp:CreateDate` und
 * `xmp:ModifyDate` mit Millisekunden ins XMP, dazu setzt der Generator
 * `setCreationDate`/`setModificationDate`. Zwei Läufe derselben Rechnung
 * unterscheiden sich also garantiert, ohne dass sich am Layout etwas geändert
 * hätte. Auch die Dateigrösse scheidet aus (siehe `kundenanforderungen.test.ts`):
 * sie wächst schon durch längeren Text, ganz ohne Umbruch.
 *
 * Verglichen wird stattdessen der entpackte Inhaltsstrom jeder Seite. Er
 * enthält genau die Zeichenanweisungen — Textmatrix, Glyphen, Linien,
 * Rechtecke — und keinen Zeitstempel. Dass er reproduzierbar ist, ist kein
 * Zufall: pdf-lib zieht seine „zufälligen" Ressourcennamen aus einem
 * `SimpleRNG.withSeed(1)` je Dokument, also deterministisch. Gleiche Eingabe
 * und gleiche Zeichenreihenfolge ergeben Byte für Byte denselben Strom.
 *
 * Das ist schärfer als blosses Zählen von Operationen: zwei vertauschte
 * Textpositionen haben dieselbe Anzahl, aber einen anderen Strom. Die Zahlen
 * (Seiten, Operationen je Seite) stehen trotzdem mit im Protokoll — weicht
 * etwas ab, sagen sie, *wo*, bevor man in den Strom schaut.
 */

/** Der festgehaltene Zustand eines erzeugten PDFs. */
export interface Charakterisierung {
  /** Anzahl Seiten. */
  seiten: number;
  /** Alle Operatoren im Inhaltsstrom, je Seite. Fängt grobe Abweichungen ab. */
  operationen: number[];
  /** Nur die textzeichnenden Tj-Operationen, je Seite — entspricht Zeilen. */
  textzeilen: number[];
  /** SHA-256 des normalisierten Inhaltsstroms, je Seite, auf 16 Hex gekürzt. */
  hashes: string[];
}

/** Ein Fall: Rechnung plus die Aufrufparameter, mit denen sie gezeichnet wird. */
export interface Fall {
  invoice: Invoice;
  language: InvoiceLanguage;
  options?: Parameters<typeof generateInvoicePDF>[2];
}

/**
 * Entpackt die Inhaltsströme eines fertigen PDFs, eine Zeichenkette je Seite.
 *
 * `Contents` darf laut PDF-Spezifikation ein einzelner Strom oder ein Array
 * sein; beides kommt hier vor, sobald ein Werkzeug den Inhalt ergänzt hat.
 */
async function inhaltsstroeme(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((seite) => {
    const contents = (seite.node as unknown as { Contents(): unknown }).Contents();
    const stroeme =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    return stroeme
      .map((strom) =>
        Buffer.from(decodePDFRawStream(strom as PDFRawStream).decode()).toString("latin1")
      )
      .join("\n");
  });
}

/**
 * Normalisiert einen Inhaltsstrom vor dem Hashen.
 *
 * Nur Zeilenenden und abschliessende Leerzeichen — inhaltlich wird nichts
 * geglättet, sonst verlöre der Hash genau die Schärfe, derentwegen er hier
 * steht. Die Normalisierung soll den Test plattformunabhängig machen, nicht
 * Unterschiede verstecken.
 */
function normalisiere(strom: string): string {
  return strom
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((zeile) => zeile.replace(/\s+$/, ""))
    .filter((zeile) => zeile.length > 0)
    .join("\n");
}

/**
 * pdf-lib schreibt genau einen Operator je Zeile, und der steht am Zeilenende.
 * Damit lassen sich Operatoren zählen, ohne den Strom zu parsen.
 */
function operatoren(strom: string): string[] {
  return normalisiere(strom)
    .split("\n")
    .map((zeile) => zeile.split(" ").pop() ?? "");
}

/** Erzeugt das PDF eines Falls und misst es. */
export async function charakterisiere(fall: Fall): Promise<Charakterisierung> {
  const bytes = await generateInvoicePDF(fall.invoice, fall.language, fall.options);
  const stroeme = await inhaltsstroeme(bytes);
  return {
    seiten: stroeme.length,
    operationen: stroeme.map((s) => operatoren(s).length),
    textzeilen: stroeme.map((s) => operatoren(s).filter((op) => op === "Tj").length),
    hashes: stroeme.map((s) =>
      createHash("sha256").update(normalisiere(s), "latin1").digest("hex").slice(0, 16)
    ),
  };
}

// ---------------------------------------------------------------------------
// Die Fälle. Jeder nimmt bewusst einen anderen Weg durchs Layout.
// ---------------------------------------------------------------------------

const positionen = (anzahl: number, beschreibung = "Leistung"): InvoiceItem[] =>
  Array.from({ length: anzahl }, (_, i) => ({
    description: `Pos. ${i + 1} ${beschreibung}`,
    quantity: 1,
    unit: "Stk",
    unitPrice: 100,
    vatRate: 19,
  }));

/** Ein Verkäufer mit allen vier Fusszeilenspalten gefüllt. */
const vollstaendigerVerkaeufer = {
  name: "Müller & Söhne Maschinenbau GmbH",
  address: {
    street: "Hauptstr",
    streetNumber: "1",
    postalCode: "10707",
    city: "Berlin",
    country: "DE",
  },
  taxNumber: "30/123/45678",
  vatId: "DE123456789",
  court: "Amtsgericht Charlottenburg",
  registerNumber: "HRB 123456",
  managingDirector: "Dr. Maximiliane Müller-Lüdenscheidt",
  phoneNumber: "+49 30 123456-0",
  email: "rechnung@mueller-soehne.de",
  contact: { name: "Max Müller", phone: "030123", email: "max@mueller-soehne.de" },
};

export const FAELLE: Record<string, Fall> = {
  // Der Normalfall: eine Position, alles auf einer Seite, Girocode aus den
  // Bankdaten der Vorlage.
  einseitig: { invoice: makeInvoice(), language: "de" },

  // Genug Positionen, dass die Seitenumbruchlogik greift und eine
  // Fortsetzungsseite mit wiederholtem Tabellenkopf entsteht.
  mehrseitig: { invoice: makeInvoice({ items: positionen(40) }), language: "de" },

  // Lange Beschreibungen: die Zeilenhöhe einer Zeile entscheidet über den
  // Umbruch, nicht die blosse Anzahl Positionen.
  langeBeschreibungen: {
    invoice: makeInvoice({
      items: positionen(20, "sehr ausführliche Leistungsbeschreibung ".repeat(8)),
    }),
    language: "de",
  },

  // Lange Firmierung, Adresszusatz und ausländisches Land — der
  // Empfängerblock muss umbrechen statt in die Metadatenspalte zu laufen.
  langeFirmierung: {
    invoice: makeInvoice({
      customer: {
        name: "Internationale Handelsgesellschaft für Maschinenbau und Anlagentechnik mbH & Co. KG",
        address: {
          street: "Bahnhofstrasse",
          streetNumber: "123a",
          addressLine2: "Abteilung Zentraleinkauf, Gebäude C, 4. Obergeschoss",
          postalCode: "8001",
          city: "Zürich",
          country: "CH",
        },
      },
    }),
    language: "de",
  },

  // Absätze in der Positionsbeschreibung: jeder Absatz wird einzeln umbrochen.
  absaetze: {
    invoice: makeInvoice({
      items: [
        {
          description:
            "Beratung Teil A\nBeratung Teil B mit deutlich mehr Text, der für sich umbrochen wird\nBeratung Teil C",
          quantity: 3,
          unit: "Std",
          unitPrice: 120,
          vatRate: 19,
        },
      ],
    }),
    language: "de",
  },

  // Stornorechnung: eigener Titel, Bezug auf die Originalrechnung, nie ein
  // Girocode.
  storno: {
    invoice: makeInvoice(),
    language: "de",
    options: { isCancellation: true, originalInvoiceNumber: "RE-2026-000" },
  },

  // Englisch: andere Beschriftungen, andere Zahlen- und Datumsformate.
  englisch: { invoice: makeInvoice({ items: positionen(3) }), language: "en" },

  // Kleinunternehmer: 0 % Umsatzsteuer mit Befreiungsgrund unter dem
  // Summenblock (§ 14 Abs. 4 Nr. 8 UStG).
  kleinunternehmer: {
    invoice: makeInvoice({
      taxRate: 0,
      items: [
        {
          description: "Beratung",
          quantity: 10,
          unit: "Std",
          unitPrice: 95,
          vatRate: 0,
          taxCategory: "E",
          exemptionReason:
            "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).",
        },
      ],
    }),
    language: "de",
  },

  // Girocode mit Umlauten im Empfänger und abweichendem Kontoinhaber — der
  // Fall, der die QR-Vektoren und die zusätzliche Fusszeile auslöst.
  mitGirocode: {
    invoice: makeInvoice({
      seller: vollstaendigerVerkaeufer,
      bankDetails: {
        iban: "DE89370400440532013000",
        bankName: "Commerzbank",
        bic: "COBADEFFXXX",
        accountHolder: "Müller und Soehne GmbH",
      },
      introText:
        "vielen Dank für Ihren Auftrag. Wir erlauben uns, die erbrachten Leistungen wie folgt in Rechnung zu stellen.",
      outroText:
        "Zahlbar innerhalb von 14 Tagen ohne Abzug.\nBitte geben Sie die Rechnungsnummer als Verwendungszweck an.",
    }),
    language: "de",
    options: { showGirocode: true },
  },

  // Dieselbe Rechnung ohne Girocode: isoliert, was der QR-Block am Layout
  // ausmacht.
  ohneGirocode: {
    invoice: makeInvoice({
      seller: vollstaendigerVerkaeufer,
      bankDetails: {
        iban: "DE89370400440532013000",
        bankName: "Commerzbank",
        bic: "COBADEFFXXX",
        accountHolder: "Müller und Soehne GmbH",
      },
      introText:
        "vielen Dank für Ihren Auftrag. Wir erlauben uns, die erbrachten Leistungen wie folgt in Rechnung zu stellen.",
      outroText:
        "Zahlbar innerhalb von 14 Tagen ohne Abzug.\nBitte geben Sie die Rechnungsnummer als Verwendungszweck an.",
    }),
    language: "de",
    options: { showGirocode: false },
  },
};
