import { XMLParser } from "fast-xml-parser";
import { generateXRechnungXML } from "../lib/zugferd-generator";
import type { Invoice } from "../lib/schema";

/**
 * Parse the CII (Cross Industry Invoice) XML that node-zugferd emits.
 * Namespace prefixes (ram:, rsm:, udt:) are stripped for easier navigation.
 * Repeated elements are forced into arrays so callers can map() safely.
 */
const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false, // keep numbers as strings, we Number() them explicitly
  ignoreAttributes: true,
  isArray: (name) =>
    ["IncludedSupplyChainTradeLineItem", "ApplicableTradeTax"].includes(name),
});

export const num = (v: unknown): number => Number(v);
export const round2 = (x: number): number => Math.round(x * 100) / 100;
/** "2026-05-31" -> "20260531" (CII format 102) */
export const toCiiDate = (iso: string): string => iso.replace(/-/g, "");

export interface ParsedInvoice {
  lines: ParsedLine[];
  taxes: ParsedTax[];
  summation: {
    lineTotal: number;
    taxBasisTotal: number;
    taxTotal: number;
    grandTotal: number;
    duePayable: number;
  };
  /** raw OccurrenceDateTime/DateTimeString of the header delivery, or undefined */
  deliveryDate: string | undefined;
  /** raw DueDateDateTime/DateTimeString of the payment terms, or undefined */
  dueDate: string | undefined;
  /** BT-48 buyer VAT identifier, or undefined */
  buyerVatId: string | undefined;
}

export interface ParsedLine {
  id: string;
  /** BT-146 item net price */
  netPrice: number;
  /** BT-149 base quantity */
  basisQuantity: number;
  /** BT-129 invoiced quantity */
  billedQuantity: number;
  /** BT-131 line net amount */
  lineTotal: number;
}

export interface ParsedTax {
  /** BT-117 category VAT amount */
  calculated: number;
  /** BT-116 category taxable base */
  basis: number;
  category: string;
  rate: number;
  /** BT-120 VAT exemption reason text */
  exemptionReason: string | undefined;
}

export async function generateAndParse(invoice: Invoice): Promise<ParsedInvoice> {
  const xml = await generateXRechnungXML(invoice);
  const doc = parser.parse(xml).CrossIndustryInvoice;
  const tx = doc.SupplyChainTradeTransaction;

  const lines: ParsedLine[] = (tx.IncludedSupplyChainTradeLineItem as any[]).map(
    (l) => {
      const price = l.SpecifiedLineTradeAgreement.NetPriceProductTradePrice;
      const settle = l.SpecifiedLineTradeSettlement;
      return {
        id: l.AssociatedDocumentLineDocument.LineID,
        netPrice: num(price.ChargeAmount),
        basisQuantity: num(price.BasisQuantity),
        billedQuantity: num(l.SpecifiedLineTradeDelivery.BilledQuantity),
        lineTotal: num(
          settle.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount
        ),
      };
    }
  );

  const settlement = tx.ApplicableHeaderTradeSettlement;
  const taxes: ParsedTax[] = (settlement.ApplicableTradeTax as any[]).map((t) => ({
    calculated: num(t.CalculatedAmount),
    basis: num(t.BasisAmount),
    category: String(t.CategoryCode),
    rate: num(t.RateApplicablePercent),
    exemptionReason: t.ExemptionReason ? String(t.ExemptionReason) : undefined,
  }));

  const buyerParty = tx.ApplicableHeaderTradeAgreement?.BuyerTradeParty;
  const buyerVatId = buyerParty?.SpecifiedTaxRegistration?.ID
    ? String(buyerParty.SpecifiedTaxRegistration.ID)
    : undefined;

  const s = settlement.SpecifiedTradeSettlementHeaderMonetarySummation;

  // Header delivery (BT-72) — empty <ApplicableHeaderTradeDelivery/> parses to "".
  const delivery = tx.ApplicableHeaderTradeDelivery;
  const deliveryDate =
    delivery && typeof delivery === "object"
      ? delivery.ActualDeliverySupplyChainEvent?.OccurrenceDateTime?.DateTimeString
      : undefined;

  const dueDate =
    settlement.SpecifiedTradePaymentTerms?.DueDateDateTime?.DateTimeString;

  return {
    lines,
    taxes,
    summation: {
      lineTotal: num(s.LineTotalAmount),
      taxBasisTotal: num(s.TaxBasisTotalAmount),
      taxTotal: num(s.TaxTotalAmount),
      grandTotal: num(s.GrandTotalAmount),
      duePayable: num(s.DuePayableAmount),
    },
    deliveryDate,
    dueDate,
    buyerVatId,
  };
}

/** Minimal valid seller/customer/bank scaffolding shared by all fixtures. */
export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    invoiceNumber: "RE-2026-001",
    invoiceDate: "2026-06-08",
    serviceDate: "2026-06-08",
    seller: {
      name: "Muster GmbH",
      address: { street: "Hauptstr", streetNumber: "1", postalCode: "10707", city: "Berlin", country: "DE" },
      taxNumber: "30/123/45678",
      vatId: "DE123456789",
      contact: { name: "Max Muster", phone: "030123", email: "max@muster.de" },
    },
    customer: {
      name: "Kunde AG",
      address: { street: "Kundenweg", streetNumber: "2", postalCode: "20095", city: "Hamburg", country: "DE" },
      additionalInfo: ["kunde@kunde.de"],
    },
    items: [{ description: "Beratung", quantity: 1, unit: "Stk", unitPrice: 100, vatRate: 19 }],
    taxRate: 19,
    currency: "EUR",
    bankDetails: { iban: "DE89370400440532013000", bankName: "Test Bank", bic: "COBADEFFXXX" },
    buyerReference: "LW-12345",
    ...overrides,
  };
}
