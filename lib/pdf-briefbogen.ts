import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, BankDetails, Seller } from "./schema";
import type { InvoiceLanguage } from "./invoice-translations";

/**
 * Der Briefbogen: alles, was jedes Geschäftsdokument dieser Anwendung gleich
 * macht — Seitenformat, Schriften, Zeichenhelfer, Seitenverwaltung, Kopf mit
 * Absender und Logo, Empfängerblock und die vierspaltige Fusszeile.
 *
 * Herausgelöst aus `lib/pdf-generator.ts`, damit das Mahnschreiben dieselbe
 * Optik bekommt, ohne dass die Rechnung ein zweites Mal entsteht. Was hier
 * steht, ist bewusst reine Darstellung und kennt weder Positionen noch
 * Summen noch ZUGFeRD.
 *
 * Verhalten ist 1:1 übernommen, bis hin zu Rundungen und Reihenfolge der
 * Zeichenoperationen. `tests/pdf-charakterisierung.test.ts` hält fest, was
 * dabei herauskommen muss.
 */

// Bundled assets, read once. PDF/A-3 requires every font embedded, so we ship a
// real TTF instead of pdf-lib's non-embeddable standard fonts. Liberation Sans
// is metric-compatible with the previous Helvetica, so the layout is unchanged.
const readAsset = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const FONT_REGULAR = readAsset("./assets/fonts/LiberationSans-Regular.ttf");
const FONT_BOLD = readAsset("./assets/fonts/LiberationSans-Bold.ttf");
/** Die kompakte sRGB-Profildatei ist der vorgeschriebene PDF/A-Output-Intent. */
export const SRGB_ICC = new Uint8Array(readAsset("./assets/icc/sRGB.icc"));

// Page setup constants
export const PAGE_WIDTH = 595.28; // A4 width in points
export const PAGE_HEIGHT = 841.89; // A4 height in points
export const MARGIN_LEFT = 50;
export const MARGIN_RIGHT = 50;
export const MARGIN_TOP = 50;
export const MARGIN_BOTTOM = 50;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
// Baseline of the footer block. Hoisted because the Girocode is anchored
// relative to it, and it must be known before the footer itself is drawn.
export const FOOTER_Y = MARGIN_BOTTOM + 60;

// Lowest baseline body content may occupy. Below it sits the footer rule, so
// anything that would cross it belongs on the next page instead.
export const CONTENT_BOTTOM = FOOTER_Y + 40;

// Colors
export const COLOR_BLACK = rgb(0, 0, 0);
export const COLOR_GRAY = rgb(0.5, 0.5, 0.5);
export const COLOR_LIGHT_GRAY = rgb(0.7, 0.7, 0.7);

export function formatAddress(address: Address): { streetLine: string; cityLine: string } {
  return {
    streetLine: `${address.street} ${address.streetNumber}`,
    cityLine: `${address.postalCode} ${address.city}`,
  };
}

// Get country name from country code
export function getCountryName(countryCode: string, language: InvoiceLanguage = 'de'): string {
  const countryNames: Record<string, { de: string; en: string }> = {
    'DE': { de: 'Deutschland', en: 'Germany' },
    'AT': { de: 'Österreich', en: 'Austria' },
    'CH': { de: 'Schweiz', en: 'Switzerland' },
    'FR': { de: 'Frankreich', en: 'France' },
    'IT': { de: 'Italien', en: 'Italy' },
    'NL': { de: 'Niederlande', en: 'Netherlands' },
    'BE': { de: 'Belgien', en: 'Belgium' },
    'PL': { de: 'Polen', en: 'Poland' },
    'CZ': { de: 'Tschechien', en: 'Czech Republic' },
    'GB': { de: 'Großbritannien', en: 'United Kingdom' },
    'US': { de: 'USA', en: 'United States' },
  };
  return countryNames[countryCode]?.[language] || countryCode;
}

// Sanitize text by removing newlines and other problematic characters for PDF rendering
export function sanitizeText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Wie sanitizeText, aber Absätze bleiben erhalten.
 *
 * Für Felder, in denen der Nutzer bewusst umbricht — etwa eine
 * Positionsbeschreibung über mehrere Zeilen. Jeder Absatz wird für sich
 * bereinigt und einzeln umbrochen; leere Absätze fallen weg, damit ein
 * versehentlicher Doppelumbruch keine Lücke ins Layout reisst.
 */
export function sanitizeParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((absatz) => absatz.replace(/\s+/g, ' ').trim())
    .filter((absatz) => absatz.length > 0);
}

export async function fetchImageAsBytes(
  url: string
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const bytes = new Uint8Array(await response.arrayBuffer());

    // Determine image type from content-type or URL
    if (contentType.includes("png") || url.toLowerCase().endsWith(".png")) {
      return { bytes, type: "png" };
    }
    if (contentType.includes("jpeg") || contentType.includes("jpg") ||
        url.toLowerCase().endsWith(".jpg") || url.toLowerCase().endsWith(".jpeg")) {
      return { bytes, type: "jpg" };
    }

    // Try to detect from magic bytes
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, type: "png" };
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return { bytes, type: "jpg" };

    return null;
  } catch {
    return null;
  }
}

/** Optionen für {@link Briefbogen.drawText}. */
export interface TextOptionen {
  font?: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  maxWidth?: number;
}

/**
 * Zustandsobjekt des laufenden Dokuments.
 *
 * Warum eine Klasse und kein Bündel freier Funktionen mit explizitem
 * Zustandsparameter: Die ursprünglichen Helfer waren Closures über `page`,
 * `y`, die Schriften und das Dokument. Als Klasse mit Pfeilfunktions-Feldern
 * bleiben sie genau das — sie lassen sich am Aufrufer weiterhin
 * destrukturieren (`const { drawText, wrapText } = bogen;`) und behalten ihren
 * Zustand. Damit ändert sich an rund zweihundert Aufrufstellen nichts ausser
 * `y` und `page`, die als öffentliche Felder am Objekt sitzen müssen, weil der
 * Aufrufer sie fortschreibt.
 */
export class Briefbogen {
  /** Alle bisher angelegten Seiten, in Reihenfolge. */
  readonly pages: PDFPage[] = [];
  /** Die Seite, auf die gerade gezeichnet wird. Ein Seitenumbruch ist eine Zuweisung. */
  page: PDFPage;
  /** Aktuelle Grundlinie. Der Aufrufer schreibt sie selbst fort. */
  y: number;

  /**
   * Inhaltsblöcke auf der aktuellen Seite. Steht sie auf 0, bricht
   * {@link ensureSpace} nicht um — ein Block, der höher ist als eine ganze
   * Seite, muss irgendwo überlaufen, und eine Endlosschleife wäre schlimmer
   * als eine zu lange Zeile.
   */
  blocksOnPage = 1; // the letterhead already occupies page one

  /**
   * Wird auf jeder neu begonnenen Seite aufgerufen, um den Fortsetzungskopf zu
   * zeichnen. Erst nach dem Titel bekannt, deshalb nachträglich setzbar.
   */
  fortsetzungskopf?: () => void;

  constructor(
    readonly doc: PDFDocument,
    ersteSeite: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont
  ) {
    this.page = ersteSeite;
    this.pages.push(ersteSeite);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  // Helper function to draw text (sanitizes text to remove newlines)
  drawText = (text: string, x: number, yPos: number, options?: TextOptionen) => {
    let sanitized = sanitizeText(text);
    const font = options?.font ?? this.regular;
    const size = options?.size ?? 10;

    // Truncate if maxWidth specified
    if (options?.maxWidth) {
      while (font.widthOfTextAtSize(sanitized, size) > options.maxWidth && sanitized.length > 3) {
        sanitized = sanitized.slice(0, -4) + '...';
      }
    }

    this.page.drawText(sanitized, {
      x,
      y: yPos,
      font,
      size,
      color: options?.color ?? COLOR_BLACK,
    });
  };

  // Helper to draw right-aligned text
  drawTextRight = (text: string, rightX: number, yPos: number, options?: TextOptionen) => {
    const sanitized = sanitizeText(text);
    const font = options?.font ?? this.regular;
    const size = options?.size ?? 10;
    const textWidth = font.widthOfTextAtSize(sanitized, size);
    this.drawText(text, rightX - textWidth, yPos, options);
  };

  // Word wrap helper — also breaks overlong single words so they never clip
  wrapText = (text: string, maxWidth: number, font: PDFFont, size: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    const pushLongWord = (word: string) => {
      let chunk = '';
      for (const char of word) {
        const test = chunk + char;
        if (font.widthOfTextAtSize(test, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk = test;
        }
      }
      currentLine = chunk;
    };

    for (const word of words) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        pushLongWord(word);
        continue;
      }

      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, size) > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  };

  /** Beginnt eine neue Seite und zeichnet den Fortsetzungskopf. */
  startPage = () => {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
    this.blocksOnPage = 0;
    this.fortsetzungskopf?.();
  };

  /**
   * Break to a new page when `needed` points of vertical space are no longer
   * available, running `onNewPage` once the fresh page is open. Never breaks on
   * a page that is still empty: a block taller than a whole page has to overflow
   * somewhere, and an endless break loop is worse than one overlong row.
   */
  ensureSpace = (needed: number, onNewPage?: () => void) => {
    if (this.y - needed >= CONTENT_BOTTOM || this.blocksOnPage === 0) return;
    this.startPage();
    onNewPage?.();
  };
}

/**
 * Legt ein PDF-Dokument mit eingebetteten Schriften und erster Seite an.
 *
 * Die Schriften werden als Teilmenge eingebettet; PDF/A-3 verlangt, dass jede
 * verwendete Schrift im Dokument steckt.
 */
export async function briefbogenAnlegen(): Promise<Briefbogen> {
  const pdfDoc = await PDFDocument.create();
  // Reihenfolge wie im ursprünglichen Generator: erst die Seite, dann die
  // Schriften. Sie bestimmt die Objektnummerierung im fertigen PDF — am Bild
  // ändert sie nichts, aber eine unnötige Abweichung bleibt eine Abweichung.
  const ersteSeite = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pdfDoc.registerFontkit(fontkit);
  const regular = await pdfDoc.embedFont(FONT_REGULAR, { subset: true });
  const bold = await pdfDoc.embedFont(FONT_BOLD, { subset: true });
  return new Briefbogen(pdfDoc, ersteSeite, regular, bold);
}

// ---------------------------------------------------------------------------
// Kopf: einzeilige Absenderangabe und Logo
// ---------------------------------------------------------------------------

/**
 * Zeichnet die einzeilige Absenderangabe oben links und das Logo oben rechts
 * und setzt die Grundlinie darunter.
 *
 * Die Absenderzeile verwendet einen Bindestrich statt eines Pfeils, weil die
 * ursprüngliche WinAnsi-Kodierung keine Pfeile kannte.
 */
export async function zeichneKopf(
  bogen: Briefbogen,
  daten: { absenderName: string; absenderAdresse: Address; logoUrl?: string }
): Promise<void> {
  const adresse = formatAddress(daten.absenderAdresse);
  const senderOneLine = `${daten.absenderName} - ${adresse.streetLine} - ${adresse.cityLine}`;
  bogen.drawText(senderOneLine, MARGIN_LEFT, bogen.y, { size: 8, color: COLOR_GRAY });

  // Logo (top right)
  let logoHeight = 0;
  if (daten.logoUrl) {
    const imageData = await fetchImageAsBytes(daten.logoUrl);
    if (imageData) {
      const image = imageData.type === "png"
        ? await bogen.doc.embedPng(imageData.bytes)
        : await bogen.doc.embedJpg(imageData.bytes);

      // Scale logo to max 150px width or 50px height
      const maxWidth = 150;
      const maxHeight = 50;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      logoHeight = scaledHeight;

      bogen.page.drawImage(image, {
        x: PAGE_WIDTH - MARGIN_RIGHT - scaledWidth,
        y: bogen.y - scaledHeight + 10,
        width: scaledWidth,
        height: scaledHeight,
      });
    }
  }

  // Move y to below both columns (increased spacing before headline)
  bogen.y -= Math.max(logoHeight, 20) + 30;
}

// ---------------------------------------------------------------------------
// Zweispalter: Empfängeranschrift links, Metadatentabelle rechts
// ---------------------------------------------------------------------------

/** Eine Zeile der rechten Metadatenspalte. Ohne Wert entfällt sie ersatzlos. */
export interface Metazeile {
  label: string;
  value: string | undefined;
}

/** Linke Spalte beginnt am linken Rand, rechte bei {@link RIGHT_COLUMN_X}. */
export const RIGHT_COLUMN_X = PAGE_WIDTH / 2 + 10;

/**
 * Zeichnet Empfängerblock und Metadatentabelle und setzt die Grundlinie unter
 * die längere der beiden Spalten.
 */
export function zeichneZweispalter(
  bogen: Briefbogen,
  daten: {
    empfaengerName: string;
    empfaengerAdresse: Address;
    language: InvoiceLanguage;
    metazeilen: Metazeile[];
  }
): void {
  const twoColumnY = bogen.y;
  const empfaenger = formatAddress(daten.empfaengerAdresse);

  // Der Block endet dort, wo rechts die Rechnungsdaten beginnen. Ohne diese
  // Grenze lief eine lange Firmierung oder Anschrift quer in die
  // Metadaten-Spalte — bei internationalen Adressen und Abteilungszusätzen
  // ist das der Regelfall, nicht die Ausnahme.
  const addressMaxWidth = RIGHT_COLUMN_X - MARGIN_LEFT - 16;

  const drawAddressLine = (text: string, bold = false) => {
    const font = bold ? bogen.bold : bogen.regular;
    for (const line of bogen.wrapText(sanitizeText(text), addressMaxWidth, font, 10)) {
      bogen.drawText(line, MARGIN_LEFT, bogen.y, bold ? { font: bogen.bold } : undefined);
      bogen.y -= 14;
    }
  };

  drawAddressLine(daten.empfaengerName, true);
  drawAddressLine(empfaenger.streetLine);
  // Zusatzzeile zwischen Strasse und Ort — Abteilung, Gebaeude, c/o.
  if (daten.empfaengerAdresse.addressLine2?.trim()) {
    drawAddressLine(daten.empfaengerAdresse.addressLine2);
  }
  drawAddressLine(empfaenger.cityLine);
  if (daten.empfaengerAdresse.country && daten.empfaengerAdresse.country !== 'DE') {
    drawAddressLine(getCountryName(daten.empfaengerAdresse.country, daten.language));
  }

  // RIGHT COLUMN: Metadata Table
  const labelX = RIGHT_COLUMN_X;
  const valueX = PAGE_WIDTH - MARGIN_RIGHT;
  const metadataLineHeight = 16;
  let metaY = twoColumnY;

  for (const { label, value } of daten.metazeilen) {
    if (!value) continue;
    bogen.drawText(label, labelX, metaY, { size: 8, color: COLOR_GRAY });
    bogen.drawTextRight(value, valueX, metaY, { size: 8 });
    metaY -= metadataLineHeight;
  }

  // Move y to below both columns (increased spacing before headline)
  bogen.y = Math.min(bogen.y, metaY) - 45;
}

// ---------------------------------------------------------------------------
// Fliesstext
// ---------------------------------------------------------------------------

/**
 * Zeichnet Absätze als umbrochenen Fliesstext.
 *
 * `umbruchSichern` entscheidet, ob vor jeder Zeile ein Seitenumbruch geprüft
 * wird. Im Briefkopfbereich ist das unnötig (dort ist immer Platz) und war im
 * ursprünglichen Code auch nicht vorhanden; nach der Positionstabelle dagegen
 * zwingend, weil der Text dort bis an die Fusszeile reichen kann.
 */
export function zeichneFliesstext(
  bogen: Briefbogen,
  absaetze: string[],
  optionen: {
    breite?: number;
    zeilenhoehe?: number;
    size?: number;
    color?: ReturnType<typeof rgb>;
    umbruchSichern?: boolean;
  } = {}
): void {
  const breite = optionen.breite ?? CONTENT_WIDTH;
  const zeilenhoehe = optionen.zeilenhoehe ?? 14;
  const size = optionen.size ?? 10;

  for (const absatz of absaetze) {
    for (const zeile of bogen.wrapText(sanitizeText(absatz), breite, bogen.regular, size)) {
      if (optionen.umbruchSichern) bogen.ensureSpace(zeilenhoehe);
      bogen.drawText(zeile, MARGIN_LEFT, bogen.y, { size, color: optionen.color });
      bogen.y -= zeilenhoehe;
      if (optionen.umbruchSichern) bogen.blocksOnPage++;
    }
  }
}

// ---------------------------------------------------------------------------
// Fusszeile: vier Spalten plus Seitenzahl, auf jeder Seite
// ---------------------------------------------------------------------------

export interface FusszeilenDaten {
  seller: Seller;
  bankDetails?: BankDetails;
  language: InvoiceLanguage;
}

/**
 * Zeichnet die vierspaltige Fusszeile und die Seitenzahl auf jede Seite.
 *
 * Erst am Ende aufzurufen: die Seitenzahl braucht die endgültige Seitenzahl,
 * und die steht erst fest, wenn der Inhalt gesetzt ist.
 */
export function zeichneFusszeileAufAllenSeiten(
  bogen: Briefbogen,
  daten: FusszeilenDaten
): void {
  const { seller, bankDetails, language } = daten;
  const sellerAddress = formatAddress(seller.address);

  const drawFooter = (): number => {
    const footerY = FOOTER_Y;
    const footerFontSize = 8;
    const footerLineHeight = 11;
    const footerColWidth = CONTENT_WIDTH / 4;
    const footerCols = [
      MARGIN_LEFT,
      MARGIN_LEFT + footerColWidth,
      MARGIN_LEFT + footerColWidth * 2,
      MARGIN_LEFT + footerColWidth * 3,
    ];

    const footerLabels = language === 'de'
      ? { phone: 'TEL.', email: 'E-MAIL', court: 'AMTSGERICHT', register: 'HR-NR.', vatId: 'UST.-ID', taxNumber: 'STEUER-NR.', director: 'GESCHÄFTSF.', bank: 'BANK', accountHolder: 'KONTOINHABER' }
      : { phone: 'PHONE', email: 'E-MAIL', court: 'REG. COURT', register: 'REG. NO.', vatId: 'VAT ID', taxNumber: 'TAX NO.', director: 'MANAGING DIR.', bank: 'BANK', accountHolder: 'ACCOUNT HOLDER' };

    // Separator line above footer
    bogen.page.drawLine({
      start: { x: MARGIN_LEFT, y: footerY + 20 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: footerY + 20 },
      thickness: 0.5,
      color: COLOR_LIGHT_GRAY,
    });

    // Helper to draw footer row - puts label and value on same line if they fit,
    // otherwise breaks and wraps the value so it never runs into the next column
    const drawFooterRow = (label: string, value: string, x: number, yPos: number, maxWidth: number): number => {
      const labelWidth = bogen.regular.widthOfTextAtSize(label + ' ', footerFontSize);
      const valueWidth = bogen.regular.widthOfTextAtSize(sanitizeText(value), footerFontSize);

      bogen.drawText(label, x, yPos, { size: footerFontSize, color: COLOR_GRAY });
      if (labelWidth + valueWidth <= maxWidth) {
        bogen.drawText(value, x + labelWidth, yPos, { size: footerFontSize });
        return yPos - footerLineHeight;
      }
      yPos -= footerLineHeight;
      return drawFooterValue(value, x, yPos, maxWidth);
    };

    // Helper to draw a footer value (no label), wrapped to the column width
    const drawFooterValue = (value: string, x: number, yPos: number, maxWidth: number): number => {
      for (const line of bogen.wrapText(sanitizeText(value), maxWidth, bogen.regular, footerFontSize)) {
        bogen.drawText(line, x, yPos, { size: footerFontSize });
        yPos -= footerLineHeight;
      }
      return yPos;
    };

    // Column 1: Company Address (no labels, just values)
    const col1Width = footerColWidth - 5;
    let col1Y = footerY;
    col1Y = drawFooterValue(seller.name, footerCols[0], col1Y, col1Width);
    col1Y = drawFooterValue(sellerAddress.streetLine, footerCols[0], col1Y, col1Width);
    col1Y = drawFooterValue(sellerAddress.cityLine, footerCols[0], col1Y, col1Width);
    if (seller.address.country) {
      drawFooterValue(getCountryName(seller.address.country, language), footerCols[0], col1Y, col1Width);
    }

    // Column 2: Contact Info
    let col2Y = footerY;
    if (seller.phoneNumber) {
      col2Y = drawFooterRow(footerLabels.phone, seller.phoneNumber, footerCols[1], col2Y, footerColWidth - 5);
    }
    if (seller.email || seller.contact?.email) {
      const email = seller.email || seller.contact?.email || '';
      col2Y = drawFooterRow(footerLabels.email, email, footerCols[1], col2Y, footerColWidth - 5);
    }

    // Column 3: Legal Info
    let col3Y = footerY;
    if (seller.court) {
      col3Y = drawFooterRow(footerLabels.court, seller.court, footerCols[2], col3Y, footerColWidth - 5);
    }
    if (seller.registerNumber) {
      col3Y = drawFooterRow(footerLabels.register, seller.registerNumber, footerCols[2], col3Y, footerColWidth - 5);
    }
    if (seller.vatId) {
      col3Y = drawFooterRow(footerLabels.vatId, seller.vatId, footerCols[2], col3Y, footerColWidth - 5);
    }
    if (seller.taxNumber) {
      col3Y = drawFooterRow(footerLabels.taxNumber, seller.taxNumber, footerCols[2], col3Y, footerColWidth - 5);
    }
    if (seller.managingDirector) {
      col3Y = drawFooterRow(footerLabels.director, seller.managingDirector, footerCols[2], col3Y, footerColWidth - 5);
    }

    // Column 4: Bank Details
    let col4Y = footerY;
    if (bankDetails) {
      // Banks match the payee name against the IBAN; when the account is held
      // under a different (e.g. shortened) name than the company, customers
      // need to see it, or their transfer gets flagged.
      const accountHolder = bankDetails.accountHolder?.trim();
      if (accountHolder && accountHolder !== seller.name.trim()) {
        col4Y = drawFooterRow(footerLabels.accountHolder, accountHolder, footerCols[3], col4Y, footerColWidth - 5);
      }
      col4Y = drawFooterRow(footerLabels.bank, bankDetails.bankName, footerCols[3], col4Y, footerColWidth - 5);
      col4Y = drawFooterRow('IBAN', bankDetails.iban, footerCols[3], col4Y, footerColWidth - 5);
      if (bankDetails.bic) {
        col4Y = drawFooterRow('BIC', bankDetails.bic, footerCols[3], col4Y, footerColWidth - 5);
      }
    }

    // Next free baseline below the bank column, which shares the right edge
    // with the page number.
    return col4Y;
  };

  const totalPages = bogen.pages.length;
  bogen.pages.forEach((footerPage, index) => {
    bogen.page = footerPage;
    const bankColumnBottom = drawFooter();
    // Drops below the bank column when it runs long (e.g. a separate account holder).
    const pageNumberY = Math.min(MARGIN_BOTTOM, bankColumnBottom);
    bogen.drawTextRight(`${index + 1}/${totalPages}`, PAGE_WIDTH - MARGIN_RIGHT, pageNumberY, {
      size: 8,
      color: COLOR_GRAY,
    });
  });
}
