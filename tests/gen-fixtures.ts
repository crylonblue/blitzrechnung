import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { generateXRechnungXML } from "../lib/zugferd-generator";
import { makeInvoice } from "./helpers";
import type { Invoice } from "../lib/schema";

// Generates representative XRechnung XML files for validation against the
// official KoSIT validator. Output dir is passed as argv[2].
const outDir = process.argv[2] || "tests/.kosit/out";

const fixtures: Record<string, Invoice> = {
  "01-single-19": makeInvoice(),
  "02-multi-rate-qty": makeInvoice({
    items: [
      { description: "Beratung", quantity: 3, unit: "Stk", unitPrice: 99.99, vatRate: 19 },
      { description: "Material", quantity: 7, unit: "Stk", unitPrice: 0.07, vatRate: 7 },
    ],
  }),
  "03-fractional-price": makeInvoice({
    items: [
      { description: "Strom kWh", quantity: 1234, unit: "KWH", unitPrice: 0.0719, vatRate: 19 },
      { description: "Grundgebühr", quantity: 1, unit: "Stk", unitPrice: 9.99, vatRate: 19 },
    ],
  }),
  "04-service-date-prev-month": makeInvoice({
    invoiceDate: "2026-06-08",
    serviceDate: "2026-05-31",
    dueDate: "2026-07-08",
  }),
  // §4 UStG: fully VAT-exempt medical service (category E + exemption reason)
  "05-exempt-par4": makeInvoice({
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
  // Mixed invoice: standard-rated consulting + exempt treatment
  "06-mixed-S-E": makeInvoice({
    items: [
      { description: "Beratung", quantity: 2, unit: "HUR", unitPrice: 100, vatRate: 19, taxCategory: "S" },
      {
        description: "Heilbehandlung",
        quantity: 1,
        unit: "Stk",
        unitPrice: 200,
        vatRate: 0,
        taxCategory: "E",
        exemptionReason: "§ 4 Nr. 14 UStG",
      },
    ],
  }),
  // §13b UStG: reverse charge (category AE, requires buyer VAT id)
  "07-reverse-charge": makeInvoice({
    customer: {
      name: "Bau AG",
      address: { street: "Baustr", streetNumber: "5", postalCode: "80331", city: "München", country: "DE" },
      additionalInfo: ["bau@bau.de"],
      vatId: "DE987654321",
    },
    items: [
      {
        description: "Bauleistung",
        quantity: 1,
        unit: "Stk",
        unitPrice: 5000,
        vatRate: 0,
        taxCategory: "AE",
        exemptionReason: "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)",
      },
    ],
  }),
};

// Cancellation invoice (Storno): document type 384, negated amounts, reference
// to the original invoice number.
const cancellation: Invoice = makeInvoice({
  invoiceNumber: "ST-2026-001",
  items: [{ description: "Beratung", quantity: -3, unit: "Stk", unitPrice: 99.99, vatRate: 19 }],
});

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, inv] of Object.entries(fixtures)) {
    const xml = await generateXRechnungXML(inv);
    writeFileSync(`${outDir}/${name}.xml`, xml, "utf8");
    console.log(`wrote ${name}.xml`);
  }
  const stornoXml = await generateXRechnungXML(cancellation, {
    isCancellation: true,
    originalInvoiceNumber: "RE-2026-001",
  });
  writeFileSync(`${outDir}/08-cancellation.xml`, stornoXml, "utf8");
  console.log("wrote 08-cancellation.xml");
}
main();
