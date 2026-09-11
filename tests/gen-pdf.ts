import { mkdirSync, writeFileSync } from "node:fs";
import { generateInvoicePDF } from "../lib/pdf-generator";
import { makeInvoice } from "./helpers";
import type { Invoice } from "../lib/schema";

// Generates real ZUGFeRD PDFs (PDF with embedded XRechnung) via the same path
// the app uses, for validation against the Mustang / veraPDF PDF-A3b validator.
const outDir = process.argv[2] || "tests/.kosit/pdf";

const fixtures: Record<string, Invoice> = {
  "standard": makeInvoice(),
  "exempt": makeInvoice({
    items: [
      {
        description: "Heilbehandlung",
        quantity: 1,
        unit: "Stk",
        unitPrice: 200,
        vatRate: 0,
        taxCategory: "E",
        exemptionReason: "Steuerfreie Heilbehandlung gemäß § 4 Nr. 14 UStG",
      },
    ],
  }),
  // Girocode with the awkward-but-common German case: umlauts in the payee and
  // a separate account holder. Re-validate this one whenever the QR drawing
  // changes — it is the fixture that proves vector modules stay PDF/A-3b.
  "girocode": makeInvoice({
    seller: {
      name: "Müller & Söhne GmbH",
      address: { street: "Hauptstr", streetNumber: "1", postalCode: "10707", city: "Berlin", country: "DE" },
      taxNumber: "30/123/45678",
      vatId: "DE123456789",
      contact: { name: "Max Müller", phone: "030123", email: "max@mueller.de" },
    },
    bankDetails: {
      iban: "DE89370400440532013000",
      bankName: "Commerzbank",
      bic: "COBADEFFXXX",
      accountHolder: "Müller & Söhne GmbH",
    },
  }),
};

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const [name, inv] of Object.entries(fixtures)) {
    const pdf = await generateInvoicePDF(inv, "de");
    writeFileSync(`${outDir}/${name}.pdf`, Buffer.from(pdf));
    console.log(`wrote ${name}.pdf (${pdf.length} bytes)`);
  }
}
main();
