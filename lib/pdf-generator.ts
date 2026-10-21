import { rgb } from "pdf-lib";
import { embedFacturX, Profile, Flavor } from "@stackforge-eu/factur-x";
import type { Invoice } from "./schema";
import { generateXRechnungXML } from "./zugferd-generator";
import { computeInvoiceTotals } from "./invoice-totals";
import { getUnitLabel } from "./units";
import { buildEpcPayload } from "./girocode";
import { encodeQrMatrix, qrMatrixToRuns } from "./qr";
import {
  briefbogenAnlegen,
  zeichneKopf,
  zeichneZweispalter,
  zeichneFliesstext,
  zeichneFusszeileAufAllenSeiten,
  sanitizeParagraphs,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  COLOR_BLACK,
  COLOR_GRAY,
  FOOTER_Y,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  PAGE_WIDTH,
  SRGB_ICC,
  type Metazeile,
} from "./pdf-briefbogen";
import {
  getTranslations,
  formatDateForLanguage,
  formatCurrencyForLanguage,
  type InvoiceLanguage
} from "./invoice-translations";

// `sanitizeParagraphs` lebt jetzt im Briefbogen, bleibt hier aber exportiert:
// bestehende Aufrufer (und Tests) beziehen sie seit jeher von hier.
export { sanitizeParagraphs };

// Girocode geometry: the code sits bottom-left, just above the footer rule, so
// it lands in the same place on every invoice instead of drifting with the
// length of the line-item table.
const GIROCODE_SIZE = 72;
const GIROCODE_BOTTOM = FOOTER_Y + 34;

// Vertical room the Girocode band claims, expressed in the content flow.
const GIROCODE_BLOCK_HEIGHT = GIROCODE_BOTTOM + GIROCODE_SIZE + 10 - CONTENT_BOTTOM;

function formatDate(dateString: string, language: InvoiceLanguage = 'de'): string {
  return formatDateForLanguage(dateString, language);
}

function getEffectiveDueDate(invoice: Invoice): string {
  if (invoice.dueDate) return invoice.dueDate;
  const invoiceDate = new Date(invoice.invoiceDate);
  invoiceDate.setDate(invoiceDate.getDate() + 14);
  return invoiceDate.toISOString().split("T")[0];
}

function formatCurrency(amount: number, language: InvoiceLanguage = 'de'): string {
  return formatCurrencyForLanguage(amount, language);
}

function formatQuantity(quantity: number, language: InvoiceLanguage = 'de'): string {
  if (language === 'de') {
    return quantity.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return quantity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Options for PDF generation
 */
interface PdfGenerationOptions {
  /** Whether this is a cancellation invoice (Stornorechnung) */
  isCancellation?: boolean;
  /** Original invoice number for cancellation invoices */
  originalInvoiceNumber?: string;
  /**
   * Print the EPC/Girocode QR code when the seller's bank details allow it.
   * Defaults to on; a cancellation invoice never carries one.
   */
  showGirocode?: boolean;
}

export async function generateInvoicePDF(
  invoice: Invoice,
  language: InvoiceLanguage = 'de',
  options: PdfGenerationOptions = {}
): Promise<Uint8Array> {
  const { isCancellation = false, originalInvoiceNumber, showGirocode = true } = options;

  // Seitenformat, Schriften, Zeichenhelfer und Seitenverwaltung kommen aus dem
  // gemeinsamen Briefbogen. Die Helfer werden destrukturiert, damit die
  // Aufrufstellen unten so aussehen wie zuvor; `y` und `page` bleiben am
  // Objekt, weil sie fortgeschrieben werden.
  const bogen = await briefbogenAnlegen();
  const { doc: pdfDoc, regular: helvetica, bold: helveticaBold } = bogen;
  const { drawText, drawTextRight, wrapText, ensureSpace } = bogen;

  // Get translations for the selected language
  const t = getTranslations(language);

  // ===========================================
  // SECTION 1: Header - One-line sender + Logo
  // ===========================================

  await zeichneKopf(bogen, {
    absenderName: invoice.seller.name,
    absenderAdresse: invoice.seller.address,
    logoUrl: invoice.logoUrl,
  });

  // ===========================================
  // SECTION 2: Two-Column Layout
  // ===========================================

  // Metadata labels based on language
  const metaLabels = language === 'de' ? {
    invoiceNumber: 'RECHNUNGS-NR.',
    invoiceDate: 'RECHNUNGSDATUM',
    reference: 'REFERENZ',
    serviceDate: 'LIEFERDATUM',
    dueDate: 'FÄLLIG BIS',
    contactPerson: 'IHR ANSPRECHPARTNER',
  } : {
    invoiceNumber: 'INVOICE NO.',
    invoiceDate: 'INVOICE DATE',
    reference: 'REFERENCE',
    serviceDate: 'DELIVERY DATE',
    dueDate: 'DUE DATE',
    contactPerson: 'YOUR CONTACT',
  };

  // Zeilen ohne Wert entfallen ersatzlos — sie dürfen keine Lücke hinterlassen.
  const metazeilen: Metazeile[] = [
    { label: metaLabels.invoiceNumber, value: invoice.invoiceNumber },
    { label: metaLabels.invoiceDate, value: formatDate(invoice.invoiceDate, language) },
    { label: metaLabels.reference, value: invoice.buyerReference },
    { label: metaLabels.serviceDate, value: formatDate(invoice.serviceDate, language) },
    { label: metaLabels.dueDate, value: formatDate(getEffectiveDueDate(invoice), language) },
    { label: metaLabels.contactPerson, value: invoice.seller.contact?.name },
  ];

  zeichneZweispalter(bogen, {
    empfaengerName: invoice.customer.name,
    empfaengerAdresse: invoice.customer.address,
    language,
    metazeilen,
  });

  // ===========================================
  // SECTION 3: Invoice Title
  // ===========================================

  // Use different title for cancellation invoices
  let invoiceTitle: string;
  if (isCancellation) {
    invoiceTitle = language === 'de'
      ? `Stornorechnung Nr. ${invoice.invoiceNumber}`
      : `Cancellation Invoice No. ${invoice.invoiceNumber}`;
  } else {
    invoiceTitle = language === 'de'
      ? `Rechnung Nr. ${invoice.invoiceNumber}`
      : `Invoice No. ${invoice.invoiceNumber}`;
  }

  const headlineSize = 14;
  const dateSize = 10;
  drawText(invoiceTitle, MARGIN_LEFT, bogen.y, { font: helveticaBold, size: headlineSize });
  // Center date vertically with the headline
  const dateCenterOffset = (headlineSize - dateSize) / 2;
  drawTextRight(formatDate(invoice.invoiceDate, language), PAGE_WIDTH - MARGIN_RIGHT, bogen.y + dateCenterOffset, { size: dateSize });

  bogen.y -= 18;

  // Show reference to original invoice for cancellation invoices
  if (isCancellation && originalInvoiceNumber) {
    const refText = t.originalInvoiceRef(originalInvoiceNumber);
    drawText(refText, MARGIN_LEFT, bogen.y, { size: 10, color: COLOR_GRAY });
    bogen.y -= 20;
  } else {
    bogen.y -= 12;
  }

  // ===========================================
  // SECTION 4: Body Text (Greeting + Intro)
  // ===========================================

  // Greeting
  const greeting = language === 'de' ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,';
  drawText(greeting, MARGIN_LEFT, bogen.y);
  bogen.y -= 20;

  // Intro text (if provided)
  if (invoice.introText) {
    zeichneFliesstext(bogen, [invoice.introText]);
  }

  bogen.y -= 20;

  // ===========================================
  // Pagination
  // ===========================================

  // A long invoice flows onto further pages instead of being drawn into — and
  // eventually straight past — the footer. Continuation pages repeat a short
  // header and the table head so a reader always knows what they are looking at.
  bogen.fortsetzungskopf = () => {
    const continued =
      language === 'de' ? `${invoiceTitle} - Fortsetzung` : `${invoiceTitle} - continued`;
    drawText(continued, MARGIN_LEFT, bogen.y, { size: 8, color: COLOR_GRAY });
    bogen.y -= 24;
  };

  // ===========================================
  // SECTION 5: Line Items Table
  // ===========================================

  // Column positions and widths
  const tableLeft = MARGIN_LEFT;
  const tableRight = PAGE_WIDTH - MARGIN_RIGHT;
  const col = {
    description: tableLeft,
    quantity: tableLeft + CONTENT_WIDTH * 0.50,
    unit: tableLeft + CONTENT_WIDTH * 0.62,
    unitPrice: tableLeft + CONTENT_WIDTH * 0.74,
    total: tableRight,
  };

  // Table header
  const tableHeaders = language === 'de'
    ? { description: 'Beschreibung', quantity: 'Menge', unit: 'Einheit', unitPrice: 'Einzelpreis', total: 'Gesamtpreis' }
    : { description: 'Description', quantity: 'Qty', unit: 'Unit', unitPrice: 'Unit Price', total: 'Total' };

  // Drawn once at the top of the table and again on every continuation page.
  const drawTableHeader = () => {
    drawText(tableHeaders.description, col.description, bogen.y, { font: helveticaBold, size: 9 });
    drawTextRight(tableHeaders.quantity, col.quantity + 40, bogen.y, { font: helveticaBold, size: 9 });
    drawText(tableHeaders.unit, col.unit, bogen.y, { font: helveticaBold, size: 9 });
    drawTextRight(tableHeaders.unitPrice, col.unitPrice + 55, bogen.y, { font: helveticaBold, size: 9 });
    drawTextRight(tableHeaders.total, col.total, bogen.y, { font: helveticaBold, size: 9 });

    // Header bottom border
    bogen.y -= 5;
    bogen.page.drawLine({
      start: { x: tableLeft, y: bogen.y },
      end: { x: tableRight, y: bogen.y },
      thickness: 0.5,
      color: COLOR_BLACK,
    });
    bogen.y -= 18;
  };

  // All amounts come from the shared EN 16931 calculator, so the PDF, the
  // embedded XRechnung and the stored totals are guaranteed identical.
  const totals = computeInvoiceTotals(
    invoice.items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate ?? invoice.taxRate,
      taxCategory: item.taxCategory,
      exemptionReason: item.exemptionReason,
    }))
  );

  // The VAT breakdown is needed before the table is drawn: the height of the
  // totals block decides whether the last row still fits on the current page.
  const sortedBreakdown = [...totals.vatBreakdown].sort((a, b) => a.rate - b.rate);
  // Mirrors the totals drawing below: leading gap, net line, one line per VAT
  // group, separator, gross line.
  const totalsBlockHeight = 44 + 16 * sortedBreakdown.length;

  drawTableHeader();

  // Table rows
  const maxDescWidth = CONTENT_WIDTH * 0.45;
  const descLineHeight = 14;

  invoice.items.forEach((item, index) => {
    const itemTotal = totals.lineNets[index];
    const descLines = sanitizeParagraphs(item.description).flatMap((absatz) =>
      wrapText(absatz, maxDescWidth, helvetica, 10)
    );
    const rowHeight = Math.max(20, descLines.length * descLineHeight + 6);

    // The totals block stays with the table: the last row reserves the space for
    // both at once, so no page ends with the final position cut off from its sums.
    const isLastRow = index === invoice.items.length - 1;
    ensureSpace(rowHeight + (isLastRow ? totalsBlockHeight : 0), drawTableHeader);

    // Description wraps within its column; qty/price stay on the first line
    descLines.forEach((line, lineIndex) => {
      drawText(line, col.description, bogen.y - lineIndex * descLineHeight);
    });

    // Quantity with unit combined for German format
    const qtyText = formatQuantity(item.quantity, language);
    drawTextRight(qtyText, col.quantity + 40, bogen.y);

    // Unit
    drawText(getUnitLabel(item.unit, language), col.unit, bogen.y);

    // Unit price
    drawTextRight(formatCurrency(item.unitPrice, language), col.unitPrice + 55, bogen.y);

    // Total
    drawTextRight(formatCurrency(itemTotal, language), col.total, bogen.y);

    bogen.y -= rowHeight;
    bogen.blocksOnPage++;
  });

  // ===========================================
  // SECTION 6: Totals Block (Right-Aligned)
  // ===========================================

  bogen.y -= 10;

  const netTotal = totals.netTotal;
  const grossTotal = totals.grossTotal;

  const totalsLabelX = tableRight - 180;
  const totalsValueX = tableRight;

  // Net total
  const netLabel = language === 'de' ? 'Gesamtbetrag netto' : 'Net total';
  drawText(netLabel, totalsLabelX, bogen.y);
  drawTextRight(formatCurrency(netTotal, language), totalsValueX, bogen.y);
  bogen.y -= 16;

  // VAT lines — one per (category, rate) breakdown, matching the XRechnung.
  for (const g of sortedBreakdown) {
    const vatLabel =
      g.category === 'E'
        ? language === 'de' ? 'Steuerfrei (§ 4 UStG)' : 'Tax-exempt (§ 4 UStG)'
        : g.category === 'AE'
        ? language === 'de' ? 'Reverse Charge (§ 13b UStG)' : 'Reverse charge (§ 13b)'
        : language === 'de' ? `Umsatzsteuer ${g.rate}%` : `VAT ${g.rate}%`;
    drawText(vatLabel, totalsLabelX, bogen.y);
    drawTextRight(formatCurrency(g.taxAmount, language), totalsValueX, bogen.y);
    bogen.y -= 16;
  }

  // Separator line
  bogen.y -= 2;
  bogen.page.drawLine({
    start: { x: totalsLabelX, y: bogen.y },
    end: { x: totalsValueX, y: bogen.y },
    thickness: 0.5,
    color: COLOR_BLACK,
  });
  bogen.y -= 12;

  // Gross total (bold)
  const grossLabel = language === 'de' ? 'Gesamtbetrag brutto' : 'Total amount';
  drawText(grossLabel, totalsLabelX, bogen.y, { font: helveticaBold });
  drawTextRight(formatCurrency(grossTotal, language), totalsValueX, bogen.y, { font: helveticaBold });

  bogen.y -= 24;

  // Exemption reasons (§14 Abs. 4 Nr. 8 UStG: tax-exempt invoices must state the
  // reason). One note per distinct reason from the VAT breakdown.
  const exemptionReasons = [
    ...new Set(
      totals.vatBreakdown
        .map((g) => g.exemptionReason?.trim())
        .filter((r): r is string => !!r)
    ),
  ];
  zeichneFliesstext(bogen, exemptionReasons, {
    size: 9,
    color: COLOR_GRAY,
    zeilenhoehe: 12,
    umbruchSichern: true,
  });

  bogen.y -= 16;

  // ===========================================
  // SECTION 7: Outro/Payment Notice
  // ===========================================

  if (invoice.outroText) {
    zeichneFliesstext(bogen, invoice.outroText.split('\n'), { umbruchSichern: true });
  }

  // ===========================================
  // SECTION 7b: Girocode (EPC069-12 QR code)
  // ===========================================

  // Scanning the code pre-fills a SEPA transfer in the customer's banking app,
  // so nobody has to retype an IBAN. Never on a cancellation invoice: a
  // Stornorechnung is not something anyone should be able to scan and pay.
  if (showGirocode && !isCancellation && invoice.bankDetails?.iban) {
    const payload = buildEpcPayload({
      beneficiaryName: invoice.bankDetails.accountHolder || invoice.seller.name,
      iban: invoice.bankDetails.iban,
      bic: invoice.bankDetails.bic,
      amount: grossTotal,
      currency: invoice.currency,
      remittanceInfo:
        language === 'de'
          ? `Rechnung ${invoice.invoiceNumber}`
          : `Invoice ${invoice.invoiceNumber}`,
    });

    if (payload) {
      // The code is anchored to a fixed band above the footer so it lands in the
      // same place on every invoice. Should the content have flowed into that
      // band, the code moves to a fresh page rather than being dropped: a
      // missing Girocode means the customer retypes an IBAN by hand.
      ensureSpace(GIROCODE_BLOCK_HEIGHT);

      const matrix = encodeQrMatrix(payload);
      const runs = qrMatrixToRuns(matrix, GIROCODE_SIZE);
      const qrLeft = MARGIN_LEFT;
      const qrTop = GIROCODE_BOTTOM + GIROCODE_SIZE;

      // A quiet zone is part of the symbol: without it a scanner may not find
      // the code against the surrounding text.
      const quietZone = (GIROCODE_SIZE / matrix.length) * 4;
      bogen.page.drawRectangle({
        x: qrLeft - quietZone,
        y: GIROCODE_BOTTOM - quietZone,
        width: GIROCODE_SIZE + quietZone * 2,
        height: GIROCODE_SIZE + quietZone * 2,
        color: rgb(1, 1, 1),
      });

      for (const run of runs) {
        bogen.page.drawRectangle({
          x: qrLeft + run.x,
          // Runs are measured from the top of the code; PDF y grows upward.
          y: qrTop - run.y - run.height,
          width: run.width,
          height: run.height,
          color: COLOR_BLACK,
        });
      }

      const captionX = qrLeft + GIROCODE_SIZE + 16;
      const captionWidth = PAGE_WIDTH - MARGIN_RIGHT - captionX;
      let captionY = qrTop - 8;

      drawText(
        language === 'de' ? 'PER BANKING-APP BEZAHLEN' : 'PAY WITH YOUR BANKING APP',
        captionX,
        captionY,
        { font: helveticaBold, size: 8 }
      );
      captionY -= 14;

      const captionBody =
        language === 'de'
          ? 'Code mit der Banking-App scannen — Empfänger, IBAN und Betrag werden automatisch ausgefüllt.'
          : 'Scan the code with your banking app — payee, IBAN and amount are filled in automatically.';
      for (const line of wrapText(captionBody, captionWidth, helvetica, 8)) {
        drawText(line, captionX, captionY, { size: 8, color: COLOR_GRAY });
        captionY -= 10;
      }

      captionY -= 2;
      const reference =
        language === 'de'
          ? `${formatCurrency(grossTotal, language)} · Verwendungszweck: Rechnung ${invoice.invoiceNumber}`
          : `${formatCurrency(grossTotal, language)} · Reference: Invoice ${invoice.invoiceNumber}`;
      for (const line of wrapText(reference, captionWidth, helvetica, 8)) {
        drawText(line, captionX, captionY, { size: 8 });
        captionY -= 10;
      }
    }
  }

  // ===========================================
  // SECTION 8: Footer (4 Columns)
  // ===========================================

  // Every page carries the footer; it is drawn at the end, when the page
  // count that the page numbers need is finally known.
  zeichneFusszeileAufAllenSeiten(bogen, {
    seller: invoice.seller,
    bankDetails: invoice.bankDetails,
    language,
  });

  // Set document metadata
  let invoiceLabel: string;
  if (isCancellation) {
    invoiceLabel = language === 'en' ? 'Cancellation Invoice' : 'Stornorechnung';
  } else {
    invoiceLabel = language === 'en' ? 'Invoice' : 'Rechnung';
  }
  pdfDoc.setTitle(`${invoiceLabel} ${invoice.invoiceNumber}`);
  pdfDoc.setAuthor(invoice.seller.name);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());
  pdfDoc.setCreator("Invoice API");
  pdfDoc.setProducer("Invoice API");

  // Save the visual PDF (fonts are now embedded via fontkit).
  const visualPdfBuffer = await pdfDoc.save({
    useObjectStreams: false,
    addDefaultPage: false,
  });

  // Generate the XRechnung XML and embed it into a PDF/A-3b conformant document.
  // embedFacturX adds the PDF/A-3 identification, the sRGB output intent, the
  // ZUGFeRD XMP metadata and the XML attachment — the parts a plain pdf-lib
  // document is missing. Verified against the Mustang/veraPDF validator.
  const xml = await generateXRechnungXML(invoice, { isCancellation, originalInvoiceNumber });
  const result = await embedFacturX({
    pdf: visualPdfBuffer,
    xml,
    profile: Profile.EN16931,
    flavor: Flavor.ZUGFERD,
    addPdfA3Metadata: true,
    rgbIccProfile: SRGB_ICC,
    unembeddedFonts: "throw", // never emit a PDF with a non-embedded font
  });

  return result.pdf;
}
