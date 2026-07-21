import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { embedFacturX, Profile, Flavor } from "@stackforge-eu/factur-x";
import type { Invoice, Address } from "./schema";
import { generateXRechnungXML } from "./zugferd-generator";
import { computeInvoiceTotals } from "./invoice-totals";
import { getUnitLabel } from "./units";

// Bundled assets, read once. PDF/A-3 requires every font embedded, so we ship a
// real TTF instead of pdf-lib's non-embeddable standard fonts. Liberation Sans
// is metric-compatible with the previous Helvetica, so the layout is unchanged.
// The compact sRGB profile is the mandatory PDF/A output intent.
const readAsset = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const FONT_REGULAR = readAsset("./assets/fonts/LiberationSans-Regular.ttf");
const FONT_BOLD = readAsset("./assets/fonts/LiberationSans-Bold.ttf");
const SRGB_ICC = new Uint8Array(readAsset("./assets/icc/sRGB.icc"));
import { 
  getTranslations, 
  formatDateForLanguage, 
  formatCurrencyForLanguage,
  type InvoiceLanguage 
} from "./invoice-translations";

// Page setup constants
const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// Colors
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GRAY = rgb(0.5, 0.5, 0.5);
const COLOR_LIGHT_GRAY = rgb(0.7, 0.7, 0.7);

function formatAddress(address: Address): { streetLine: string; cityLine: string } {
  return {
    streetLine: `${address.street} ${address.streetNumber}`,
    cityLine: `${address.postalCode} ${address.city}`,
  };
}

async function fetchImageAsBytes(url: string): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
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

// Sanitize text by removing newlines and other problematic characters for PDF rendering
function sanitizeText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Get country name from country code
function getCountryName(countryCode: string, language: InvoiceLanguage = 'de'): string {
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

/**
 * Options for PDF generation
 */
interface PdfGenerationOptions {
  /** Whether this is a cancellation invoice (Stornorechnung) */
  isCancellation?: boolean;
  /** Original invoice number for cancellation invoices */
  originalInvoiceNumber?: string;
}

export async function generateInvoicePDF(
  invoice: Invoice, 
  language: InvoiceLanguage = 'de',
  options: PdfGenerationOptions = {}
): Promise<Uint8Array> {
  const { isCancellation = false, originalInvoiceNumber } = options;
  
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  pdfDoc.registerFontkit(fontkit);
  const helvetica = await pdfDoc.embedFont(FONT_REGULAR, { subset: true });
  const helveticaBold = await pdfDoc.embedFont(FONT_BOLD, { subset: true });
  
  let y = PAGE_HEIGHT - MARGIN_TOP;
  
  // Get translations for the selected language
  const t = getTranslations(language);
  
  // Helper function to draw text (sanitizes text to remove newlines)
  const drawText = (text: string, x: number, yPos: number, options?: { 
    font?: typeof helvetica; 
    size?: number; 
    color?: typeof COLOR_BLACK;
    maxWidth?: number;
  }) => {
    let sanitized = sanitizeText(text);
    const font = options?.font ?? helvetica;
    const size = options?.size ?? 10;
    
    // Truncate if maxWidth specified
    if (options?.maxWidth) {
      while (font.widthOfTextAtSize(sanitized, size) > options.maxWidth && sanitized.length > 3) {
        sanitized = sanitized.slice(0, -4) + '...';
      }
    }
    
    page.drawText(sanitized, {
      x,
      y: yPos,
      font,
      size,
      color: options?.color ?? COLOR_BLACK,
    });
  };

  // Helper to draw right-aligned text
  const drawTextRight = (text: string, rightX: number, yPos: number, options?: { 
    font?: typeof helvetica; 
    size?: number; 
    color?: typeof COLOR_BLACK;
  }) => {
    const sanitized = sanitizeText(text);
    const font = options?.font ?? helvetica;
    const size = options?.size ?? 10;
    const textWidth = font.widthOfTextAtSize(sanitized, size);
    drawText(text, rightX - textWidth, yPos, options);
  };

  // Word wrap helper — also breaks overlong single words so they never clip
  const wrapText = (text: string, maxWidth: number, font: typeof helvetica, size: number): string[] => {
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

  const sellerAddress = formatAddress(invoice.seller.address);
  const rightColumnX = PAGE_WIDTH / 2 + 10;

  // ===========================================
  // SECTION 1: Header - One-line sender + Logo
  // ===========================================
  
  // One-line sender address (top left, small font)
  // Using bullet character instead of arrow (→) as WinAnsi encoding doesn't support arrows
  const senderOneLine = `${invoice.seller.name} - ${sellerAddress.streetLine} - ${sellerAddress.cityLine}`;
  drawText(senderOneLine, MARGIN_LEFT, y, { size: 8, color: COLOR_GRAY });

  // Logo (top right)
  let logoHeight = 0;
  if (invoice.logoUrl) {
    const imageData = await fetchImageAsBytes(invoice.logoUrl);
    if (imageData) {
      const image = imageData.type === "png" 
        ? await pdfDoc.embedPng(imageData.bytes)
        : await pdfDoc.embedJpg(imageData.bytes);
      
      // Scale logo to max 150px width or 50px height
      const maxWidth = 150;
      const maxHeight = 50;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      logoHeight = scaledHeight;
      
      page.drawImage(image, {
        x: PAGE_WIDTH - MARGIN_RIGHT - scaledWidth,
        y: y - scaledHeight + 10,
        width: scaledWidth,
        height: scaledHeight,
      });
    }
  }

  // ===========================================
  // SECTION 2: Two-Column Layout
  // ===========================================
  
  y -= Math.max(logoHeight, 20) + 30;
  const twoColumnY = y;

  // LEFT COLUMN: Recipient Address Block
  const customerAddress = formatAddress(invoice.customer.address);
  
  drawText(invoice.customer.name, MARGIN_LEFT, y, { font: helveticaBold });
  y -= 14;
  drawText(customerAddress.streetLine, MARGIN_LEFT, y);
  y -= 14;
  drawText(customerAddress.cityLine, MARGIN_LEFT, y);
  y -= 14;
  if (invoice.customer.address.country && invoice.customer.address.country !== 'DE') {
    drawText(getCountryName(invoice.customer.address.country, language), MARGIN_LEFT, y);
    y -= 14;
  }

  // RIGHT COLUMN: Metadata Table
  const metadataY = twoColumnY;
  const labelX = rightColumnX;
  const valueX = PAGE_WIDTH - MARGIN_RIGHT;
  const metadataLineHeight = 16;
  let metaY = metadataY;

  const drawMetadataRow = (label: string, value: string | undefined, yPos: number) => {
    if (!value) return yPos;
    drawText(label, labelX, yPos, { size: 8, color: COLOR_GRAY });
    drawTextRight(value, valueX, yPos, { size: 8 });
    return yPos - metadataLineHeight;
  };

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

  metaY = drawMetadataRow(metaLabels.invoiceNumber, invoice.invoiceNumber, metaY);
  metaY = drawMetadataRow(metaLabels.invoiceDate, formatDate(invoice.invoiceDate, language), metaY);
  if (invoice.buyerReference) {
    metaY = drawMetadataRow(metaLabels.reference, invoice.buyerReference, metaY);
  }
  metaY = drawMetadataRow(metaLabels.serviceDate, formatDate(invoice.serviceDate, language), metaY);
  metaY = drawMetadataRow(metaLabels.dueDate, formatDate(getEffectiveDueDate(invoice), language), metaY);
  if (invoice.seller.contact?.name) {
    metaY = drawMetadataRow(metaLabels.contactPerson, invoice.seller.contact.name, metaY);
  }

  // Move y to below both columns (increased spacing before headline)
  y = Math.min(y, metaY) - 45;

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
  drawText(invoiceTitle, MARGIN_LEFT, y, { font: helveticaBold, size: headlineSize });
  // Center date vertically with the headline
  const dateCenterOffset = (headlineSize - dateSize) / 2;
  drawTextRight(formatDate(invoice.invoiceDate, language), PAGE_WIDTH - MARGIN_RIGHT, y + dateCenterOffset, { size: dateSize });

  y -= 18;
  
  // Show reference to original invoice for cancellation invoices
  if (isCancellation && originalInvoiceNumber) {
    const refText = t.originalInvoiceRef(originalInvoiceNumber);
    drawText(refText, MARGIN_LEFT, y, { size: 10, color: COLOR_GRAY });
    y -= 20;
  } else {
    y -= 12;
  }

  // ===========================================
  // SECTION 4: Body Text (Greeting + Intro)
  // ===========================================
  
  // Greeting
  const greeting = language === 'de' ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,';
  drawText(greeting, MARGIN_LEFT, y);
  y -= 20;

  // Intro text (if provided)
  if (invoice.introText) {
    const introLines = wrapText(sanitizeText(invoice.introText), CONTENT_WIDTH, helvetica, 10);
    for (const line of introLines) {
      drawText(line, MARGIN_LEFT, y);
      y -= 14;
    }
  }

  y -= 20;

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

  drawText(tableHeaders.description, col.description, y, { font: helveticaBold, size: 9 });
  drawTextRight(tableHeaders.quantity, col.quantity + 40, y, { font: helveticaBold, size: 9 });
  drawText(tableHeaders.unit, col.unit, y, { font: helveticaBold, size: 9 });
  drawTextRight(tableHeaders.unitPrice, col.unitPrice + 55, y, { font: helveticaBold, size: 9 });
  drawTextRight(tableHeaders.total, col.total, y, { font: helveticaBold, size: 9 });

  // Header bottom border
  y -= 5;
  page.drawLine({
    start: { x: tableLeft, y },
    end: { x: tableRight, y },
    thickness: 0.5,
    color: COLOR_BLACK,
  });

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

  // Table rows
  y -= 18;
  const maxDescWidth = CONTENT_WIDTH * 0.45;
  const descLineHeight = 14;

  invoice.items.forEach((item, index) => {
    const itemTotal = totals.lineNets[index];
    const descLines = wrapText(sanitizeText(item.description), maxDescWidth, helvetica, 10);

    // Description wraps within its column; qty/price stay on the first line
    descLines.forEach((line, lineIndex) => {
      drawText(line, col.description, y - lineIndex * descLineHeight);
    });

    // Quantity with unit combined for German format
    const qtyText = formatQuantity(item.quantity, language);
    drawTextRight(qtyText, col.quantity + 40, y);

    // Unit
    drawText(getUnitLabel(item.unit), col.unit, y);

    // Unit price
    drawTextRight(formatCurrency(item.unitPrice, language), col.unitPrice + 55, y);

    // Total
    drawTextRight(formatCurrency(itemTotal, language), col.total, y);

    const rowHeight = Math.max(20, descLines.length * descLineHeight + 6);
    y -= rowHeight;
  });

  // ===========================================
  // SECTION 6: Totals Block (Right-Aligned)
  // ===========================================
  
  y -= 10;

  const netTotal = totals.netTotal;
  const grossTotal = totals.grossTotal;

  const totalsLabelX = tableRight - 180;
  const totalsValueX = tableRight;

  // Net total
  const netLabel = language === 'de' ? 'Gesamtbetrag netto' : 'Net total';
  drawText(netLabel, totalsLabelX, y);
  drawTextRight(formatCurrency(netTotal, language), totalsValueX, y);
  y -= 16;

  // VAT lines — one per (category, rate) breakdown, matching the XRechnung.
  const sortedBreakdown = [...totals.vatBreakdown].sort((a, b) => a.rate - b.rate);
  for (const g of sortedBreakdown) {
    const vatLabel =
      g.category === 'E'
        ? language === 'de' ? 'Steuerfrei (§ 4 UStG)' : 'Tax-exempt (§ 4 UStG)'
        : g.category === 'AE'
        ? language === 'de' ? 'Reverse Charge (§ 13b UStG)' : 'Reverse charge (§ 13b)'
        : language === 'de' ? `Umsatzsteuer ${g.rate}%` : `VAT ${g.rate}%`;
    drawText(vatLabel, totalsLabelX, y);
    drawTextRight(formatCurrency(g.taxAmount, language), totalsValueX, y);
    y -= 16;
  }

  // Separator line
  y -= 2;
  page.drawLine({
    start: { x: totalsLabelX, y },
    end: { x: totalsValueX, y },
    thickness: 0.5,
    color: COLOR_BLACK,
  });
  y -= 12;

  // Gross total (bold)
  const grossLabel = language === 'de' ? 'Gesamtbetrag brutto' : 'Total amount';
  drawText(grossLabel, totalsLabelX, y, { font: helveticaBold });
  drawTextRight(formatCurrency(grossTotal, language), totalsValueX, y, { font: helveticaBold });

  y -= 24;

  // Exemption reasons (§14 Abs. 4 Nr. 8 UStG: tax-exempt invoices must state the
  // reason). One note per distinct reason from the VAT breakdown.
  const exemptionReasons = [
    ...new Set(
      totals.vatBreakdown
        .map((g) => g.exemptionReason?.trim())
        .filter((r): r is string => !!r)
    ),
  ];
  for (const reason of exemptionReasons) {
    for (const wrapped of wrapText(sanitizeText(reason), CONTENT_WIDTH, helvetica, 9)) {
      drawText(wrapped, MARGIN_LEFT, y, { size: 9, color: COLOR_GRAY });
      y -= 12;
    }
  }

  y -= 16;

  // ===========================================
  // SECTION 7: Outro/Payment Notice
  // ===========================================
  
  if (invoice.outroText) {
    const outroLines = invoice.outroText.split('\n');
    for (const line of outroLines) {
      const wrappedLines = wrapText(sanitizeText(line), CONTENT_WIDTH, helvetica, 10);
      for (const wrappedLine of wrappedLines) {
        drawText(wrappedLine, MARGIN_LEFT, y);
        y -= 14;
      }
    }
  }

  // ===========================================
  // SECTION 8: Footer (4 Columns)
  // ===========================================
  
  const footerY = MARGIN_BOTTOM + 60;
  const footerFontSize = 8;
  const footerLineHeight = 11;
  const footerColWidth = CONTENT_WIDTH / 4;
  const footerCols = [
    MARGIN_LEFT,
    MARGIN_LEFT + footerColWidth,
    MARGIN_LEFT + footerColWidth * 2,
    MARGIN_LEFT + footerColWidth * 3,
  ];

  // Separator line above footer
  page.drawLine({
    start: { x: MARGIN_LEFT, y: footerY + 20 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: footerY + 20 },
    thickness: 0.5,
    color: COLOR_LIGHT_GRAY,
  });

  // Helper to draw footer row - puts label and value on same line if they fit, otherwise breaks
  const drawFooterRow = (label: string, value: string, x: number, yPos: number, maxWidth: number): number => {
    const labelWidth = helvetica.widthOfTextAtSize(label + ' ', footerFontSize);
    const valueWidth = helvetica.widthOfTextAtSize(value, footerFontSize);
    const totalWidth = labelWidth + valueWidth;
    
    if (totalWidth <= maxWidth) {
      // Fits on one line
      drawText(label, x, yPos, { size: footerFontSize, color: COLOR_GRAY });
      drawText(value, x + labelWidth, yPos, { size: footerFontSize });
      return yPos - footerLineHeight;
    } else {
      // Break to two lines
      drawText(label, x, yPos, { size: footerFontSize, color: COLOR_GRAY });
      yPos -= footerLineHeight;
      drawText(value, x, yPos, { size: footerFontSize });
      return yPos - footerLineHeight;
    }
  };

  // Helper to draw footer value only (no label)
  const drawFooterValue = (value: string, x: number, yPos: number) => {
    drawText(value, x, yPos, { size: footerFontSize });
  };

  // Column 1: Company Address (no labels, just values)
  let col1Y = footerY;
  drawFooterValue(invoice.seller.name, footerCols[0], col1Y);
  col1Y -= footerLineHeight;
  drawFooterValue(sellerAddress.streetLine, footerCols[0], col1Y);
  col1Y -= footerLineHeight;
  drawFooterValue(sellerAddress.cityLine, footerCols[0], col1Y);
  if (invoice.seller.address.country) {
    col1Y -= footerLineHeight;
    drawFooterValue(getCountryName(invoice.seller.address.country, language), footerCols[0], col1Y);
  }

  // Column 2: Contact Info
  let col2Y = footerY;
  if (invoice.seller.phoneNumber) {
    col2Y = drawFooterRow('TEL.', invoice.seller.phoneNumber, footerCols[1], col2Y, footerColWidth - 5);
  }
  if (invoice.seller.email || invoice.seller.contact?.email) {
    const email = invoice.seller.email || invoice.seller.contact?.email || '';
    col2Y = drawFooterRow('E-MAIL', email, footerCols[1], col2Y, footerColWidth - 5);
  }

  // Column 3: Legal Info
  let col3Y = footerY;
  if (invoice.seller.court) {
    col3Y = drawFooterRow('AMTSGERICHT', invoice.seller.court, footerCols[2], col3Y, footerColWidth - 5);
  }
  if (invoice.seller.registerNumber) {
    col3Y = drawFooterRow('HR-NR.', invoice.seller.registerNumber, footerCols[2], col3Y, footerColWidth - 5);
  }
  if (invoice.seller.vatId) {
    col3Y = drawFooterRow('UST.-ID', invoice.seller.vatId, footerCols[2], col3Y, footerColWidth - 5);
  }
  if (invoice.seller.taxNumber) {
    col3Y = drawFooterRow('STEUER-NR.', invoice.seller.taxNumber, footerCols[2], col3Y, footerColWidth - 5);
  }
  if (invoice.seller.managingDirector) {
    col3Y = drawFooterRow('GESCHÄFTSF.', invoice.seller.managingDirector, footerCols[2], col3Y, footerColWidth - 5);
  }

  // Column 4: Bank Details
  let col4Y = footerY;
  if (invoice.bankDetails) {
    col4Y = drawFooterRow('BANK', invoice.bankDetails.bankName, footerCols[3], col4Y, footerColWidth - 5);
    col4Y = drawFooterRow('IBAN', invoice.bankDetails.iban, footerCols[3], col4Y, footerColWidth - 5);
    if (invoice.bankDetails.bic) {
      col4Y = drawFooterRow('BIC', invoice.bankDetails.bic, footerCols[3], col4Y, footerColWidth - 5);
    }
  }

  // Page number (bottom right)
  const pageNumberText = '1/1';
  drawTextRight(pageNumberText, PAGE_WIDTH - MARGIN_RIGHT, MARGIN_BOTTOM, { size: 8, color: COLOR_GRAY });

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
