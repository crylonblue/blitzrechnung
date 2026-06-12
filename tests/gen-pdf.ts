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
