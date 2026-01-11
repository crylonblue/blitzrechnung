import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Invoice, InvoiceItem, Address } from "./schema";
import { embedZugferdIntoPDF } from "./zugferd-generator";
import { getUnitLabel } from "./units";

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

function formatDate(dateString: string): string {
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function calculateItemTotal(item: InvoiceItem): number {
  return item.quantity * item.unitPrice;
}

// Sanitize text by removing newlines and other problematic characters for PDF rendering
function sanitizeText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function generateInvoicePDF(invoice: Invoice): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
  
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const { width, height } = page.getSize();
  const margin = 50;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  
  let y = height - margin;
  
  // Logo (if provided)
  if (invoice.logoUrl) {
    const imageData = await fetchImageAsBytes(invoice.logoUrl);
    if (imageData) {
      const image = imageData.type === "png" 
        ? await pdfDoc.embedPng(imageData.bytes)
        : await pdfDoc.embedJpg(imageData.bytes);
      
      // Scale logo to max 120px width or 60px height
      const maxWidth = 120;
      const maxHeight = 60;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const scaledWidth = image.width * scale;
      const scaledHeight = image.height * scale;
      
      page.drawImage(image, {
        x: margin,
        y: height - margin - scaledHeight,
        width: scaledWidth,
        height: scaledHeight,
      });
      
      y = height - margin - scaledHeight - 20;
    }
  }

  // Helper function to draw text (sanitizes text to remove newlines)
  const drawText = (text: string, x: number, yPos: number, options?: { font?: typeof helvetica; size?: number; color?: typeof black }) => {
    const sanitized = sanitizeText(text);
    page.drawText(sanitized, {
      x,
      y: yPos,
      font: options?.font ?? helvetica,
      size: options?.size ?? 10,
      color: options?.color ?? black,
    });
  };

  // Seller Info (top right) - always at fixed position from top
  const sellerY = height - margin;
  
  // Seller name (bold)
  const sellerNameWidth = helveticaBold.widthOfTextAtSize(sanitizeText(invoice.seller.name), 10);
  drawText(invoice.seller.name, width - margin - sellerNameWidth, sellerY, { font: helveticaBold });
  
  // Build remaining seller lines (not bold)
  const sellerAddress = formatAddress(invoice.seller.address);
  const sellerLines = [
    invoice.seller.subHeadline,
    sellerAddress.streetLine,
    sellerAddress.cityLine,
    invoice.seller.taxNumber ? `Steuernummer: ${invoice.seller.taxNumber}` : null,
    invoice.seller.vatId ? `USt-IdNr.: ${invoice.seller.vatId}` : null,
  ].filter(Boolean) as string[];

  sellerLines.forEach((line, i) => {
    const sanitizedLine = sanitizeText(line);
    const textWidth = helvetica.widthOfTextAtSize(sanitizedLine, 10);
    drawText(line, width - margin - textWidth, sellerY - ((i + 1) * 14));
  });

  // Customer Info (left side)
  y = height - 170;
  drawText(invoice.customer.name, margin, y);
  
  // Address on two lines: street + number, then postal code + city
  const customerAddress = formatAddress(invoice.customer.address);
  drawText(customerAddress.streetLine, margin, y - 14);
  drawText(customerAddress.cityLine, margin, y - 28);
  
  let customerLineOffset = 42; // After name + 2 address lines
  
  // Phone number (if provided)
  if (invoice.customer.phoneNumber) {
    drawText(`Tel.: ${invoice.customer.phoneNumber}`, margin, y - customerLineOffset);
    customerLineOffset += 14;
  }
  
  const additionalInfoCount = invoice.customer.additionalInfo?.length ?? 0;
  if (additionalInfoCount > 0) {
    // Add spacing before additionalInfo (at least 2 lines = 28 pixels)
    customerLineOffset += 28;
    invoice.customer.additionalInfo!.forEach((info, i) => {
      drawText(info, margin, y - customerLineOffset - (i * 14), { color: gray });
    });
  }

  // Invoice Title - adjust position based on customer info lines
  const customerSectionHeight = customerLineOffset + (additionalInfoCount * 14) + 30;
  y -= customerSectionHeight;
  drawText("RECHNUNG", margin, y, { font: helveticaBold, size: 24 });

  // Invoice Details
  y -= 40;
  drawText(`Rechnungsnummer: ${invoice.invoiceNumber}`, margin, y);
  drawText(`Rechnungsdatum: ${formatDate(invoice.invoiceDate)}`, margin, y - 14);
  drawText(`Leistungsdatum: ${formatDate(invoice.serviceDate)}`, margin, y - 28);

  // Table Header
  y -= 70;
  const colPositions = {
    description: margin,
    quantity: 300,
    unit: 350,
    unitPrice: 410,
    total: 480,
  };
  const colRightEdges = {
    unitPrice: colPositions.total - 10, // Right edge of unitPrice column
    total: width - margin, // Right edge of total column
  };

  drawText("Beschreibung", colPositions.description, y, { font: helveticaBold });
  drawText("Menge", colPositions.quantity, y, { font: helveticaBold });
  drawText("Einheit", colPositions.unit, y, { font: helveticaBold });
  drawText("Preis", colPositions.unitPrice, y, { font: helveticaBold });
  drawText("Gesamt", colPositions.total, y, { font: helveticaBold });

  // Separator line
  y -= 5;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: black,
  });

  // Table Rows
  y -= 20;
  let netTotal = 0;

  for (const item of invoice.items) {
    const itemTotal = calculateItemTotal(item);
    netTotal += itemTotal;

    // Truncate long descriptions
    let description = sanitizeText(item.description);
    const maxDescWidth = 240;
    while (helvetica.widthOfTextAtSize(description, 10) > maxDescWidth && description.length > 0) {
      description = description.slice(0, -1);
    }
    if (description !== sanitizeText(item.description)) {
      description = description.slice(0, -3) + "...";
    }

    drawText(description, colPositions.description, y);
    drawText(item.quantity.toString(), colPositions.quantity, y);
    drawText(getUnitLabel(item.unit), colPositions.unit, y);
    // Right-align unitPrice
    const unitPriceText = formatCurrency(item.unitPrice);
    const sanitizedUnitPriceText = sanitizeText(unitPriceText);
    const unitPriceWidth = helvetica.widthOfTextAtSize(sanitizedUnitPriceText, 10);
    drawText(unitPriceText, colRightEdges.unitPrice - unitPriceWidth, y);
    // Right-align unitTotal
    const unitTotalText = formatCurrency(itemTotal);
    const sanitizedUnitTotalText = sanitizeText(unitTotalText);
    const unitTotalWidth = helvetica.widthOfTextAtSize(sanitizedUnitTotalText, 10);
    drawText(unitTotalText, colRightEdges.total - unitTotalWidth, y);

    y -= 20;
  }

  // Separator line before totals
  y -= 10;
  page.drawLine({
    start: { x: 350, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: black,
  });

  // Calculate VAT per rate (supports multiple VAT rates)
  const vatByRate = new Map<number, { basis: number; tax: number }>();
  let totalTax = 0;
  
  for (const item of invoice.items) {
    const itemNet = item.quantity * item.unitPrice;
    const itemVatRate = item.vatRate ?? invoice.taxRate; // Use item rate or fallback
    const itemTax = itemNet * (itemVatRate / 100);
    totalTax += itemTax;
    
    const existing = vatByRate.get(itemVatRate) || { basis: 0, tax: 0 };
    vatByRate.set(itemVatRate, {
      basis: existing.basis + itemNet,
      tax: existing.tax + itemTax,
    });
  }
  
  const grossTotal = netTotal + totalTax;

  // Totals
  y -= 20;
  drawText("Nettobetrag:", 350, y);
  // Right-align netTotal
  const netTotalText = formatCurrency(netTotal);
  const sanitizedNetTotalText = sanitizeText(netTotalText);
  const netTotalWidth = helvetica.widthOfTextAtSize(sanitizedNetTotalText, 10);
  drawText(netTotalText, colRightEdges.total - netTotalWidth, y);

  // Show VAT lines per rate
  const sortedVatRates = Array.from(vatByRate.entries()).sort((a, b) => a[0] - b[0]);
  for (const [rate, amounts] of sortedVatRates) {
    y -= 18;
    drawText(`MwSt. (${rate}%):`, 350, y);
    // Right-align taxAmount
    const taxAmountText = formatCurrency(amounts.tax);
    const sanitizedTaxAmountText = sanitizeText(taxAmountText);
    const taxAmountWidth = helvetica.widthOfTextAtSize(sanitizedTaxAmountText, 10);
    drawText(taxAmountText, colRightEdges.total - taxAmountWidth, y);
  }

  y -= 10;
  page.drawLine({
    start: { x: 350, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: black,
  });

  y -= 15;
  drawText("Gesamtbetrag:", 350, y, { font: helveticaBold });
  // Right-align grossTotal
  const grossTotalText = formatCurrency(grossTotal);
  const sanitizedGrossTotalText = sanitizeText(grossTotalText);
  const grossTotalWidth = helveticaBold.widthOfTextAtSize(sanitizedGrossTotalText, 10);
  drawText(grossTotalText, colRightEdges.total - grossTotalWidth, y, { font: helveticaBold });

  // Bank Details
  if (invoice.bankDetails) {
    y -= 50;
    drawText("Bankverbindung:", margin, y, { font: helveticaBold });
    y -= 14;
    drawText(`IBAN: ${invoice.bankDetails.iban}`, margin, y);
    y -= 14;
    drawText(`Bank: ${invoice.bankDetails.bankName}`, margin, y);
  }

  // Note
  if (invoice.note) {
    y -= 40;
    drawText(invoice.note, margin, y, { color: gray });
  }

  // Footer
  const footerParts = [
    invoice.seller.name,
    `${sellerAddress.streetLine}, ${sellerAddress.cityLine}`,
    invoice.seller.phoneNumber ? `Tel.: ${invoice.seller.phoneNumber}` : null,
  ].filter(Boolean) as string[];
  const footerText = footerParts.join(' | ');
  const sanitizedFooterText = sanitizeText(footerText);
  const footerWidth = helvetica.widthOfTextAtSize(sanitizedFooterText, 8);
  page.drawText(sanitizedFooterText, {
    x: (width - footerWidth) / 2,
    y: margin,
    font: helvetica,
    size: 8,
    color: gray,
  });

  // Set document metadata
  pdfDoc.setTitle(`Rechnung ${invoice.invoiceNumber}`);
  pdfDoc.setAuthor(invoice.seller.name);
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());
  pdfDoc.setCreator("Invoice API");
  pdfDoc.setProducer("Invoice API");

  // Save the visual PDF first
  // Use save with options to ensure fonts are embedded and structure is correct
  // Note: pdf-lib doesn't create PDF/A-3b directly, but node-zugferd will convert it
  const visualPdfBuffer = await pdfDoc.save({
    useObjectStreams: false, // Disable object streams for better compatibility
    addDefaultPage: false, // Don't add default page
  });

  // Embed ZUGFeRD XML into PDF and convert to PDF/A-3b compliant document
  const zugferdPdfBuffer = await embedZugferdIntoPDF(invoice, visualPdfBuffer);

  return zugferdPdfBuffer;
}
