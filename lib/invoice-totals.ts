import type { TaxCategory } from "./schema";

/**
 * Single source of truth for EN 16931 invoice arithmetic.
 *
 * The XML generator, the PDF generator and the draft API routes all derive
 * their amounts from here, so the printed PDF, the embedded XRechnung and the
 * stored totals can never disagree. The model is "round per line, then sum the
 * rounded values" (avoids BR-CO-10/14 violations), with the item net price kept
 * at 4 decimals so the validator's line recomputation matches BT-131.
 */

export const round2 = (x: number): number =>
  parseFloat((Math.round(x * 100) / 100).toFixed(2));
export const round4 = (x: number): number =>
  parseFloat((Math.round(x * 10000) / 10000).toFixed(4));

export interface TotalsLineInput {
  quantity: number;
  unitPrice: number;
  /** Already-resolved VAT rate (item rate or invoice fallback). */
  vatRate: number;
  taxCategory?: TaxCategory;
  exemptionReason?: string;
}

export interface VatBreakdownGroup {
  category: TaxCategory; // BT-118
  rate: number; // BT-119
  basisAmount: number; // BT-116
  taxAmount: number; // BT-117
  exemptionReason?: string; // BT-120
}

export interface InvoiceTotals {
  netTotal: number; // BT-106 sum of line net amounts
  taxAmount: number; // BT-110 total VAT
  grossTotal: number; // BT-112 / BT-115 grand total
  lineNets: number[]; // BT-131 per input line, in input order
  vatBreakdown: VatBreakdownGroup[];
}

/** Derive a line's VAT category: explicit, or implied by the rate (S/Z). */
export function categoryFor(
  taxCategory: TaxCategory | undefined,
  rate: number
): TaxCategory {
  return taxCategory ?? (rate === 0 ? "Z" : "S");
}

export function computeInvoiceTotals(lines: TotalsLineInput[]): InvoiceTotals {
  // Group by (category, rate); EN 16931 needs one VAT breakdown per combination.
  const groups = new Map<
    string,
    { category: TaxCategory; rate: number; basisAmount: number; exemptionReason?: string }
  >();
  const lineNets: number[] = [];
  let netTotal = 0;

  for (const line of lines) {
    const category = categoryFor(line.taxCategory, line.vatRate);
    const lineNet = round2(line.quantity * round4(line.unitPrice)); // BT-131
    lineNets.push(lineNet);
    netTotal = round2(netTotal + lineNet);

    const key = `${category}|${line.vatRate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.basisAmount = round2(existing.basisAmount + lineNet);
      if (!existing.exemptionReason && line.exemptionReason) {
        existing.exemptionReason = line.exemptionReason;
      }
    } else {
      groups.set(key, {
        category,
        rate: line.vatRate,
        basisAmount: lineNet,
        exemptionReason: line.exemptionReason || undefined,
      });
    }
  }

  // BR-CO-17 / BR-E-09 / BR-AE-09: category VAT from the rounded category base.
  const vatBreakdown: VatBreakdownGroup[] = Array.from(groups.values()).map((g) => ({
    category: g.category,
    rate: g.rate,
    basisAmount: g.basisAmount,
    taxAmount: round2((g.basisAmount * g.rate) / 100), // 0 for E/AE/Z
    exemptionReason: g.exemptionReason,
  }));

  const taxAmount = round2(vatBreakdown.reduce((sum, g) => sum + g.taxAmount, 0));
  const grossTotal = round2(netTotal + taxAmount);

  return { netTotal, taxAmount, grossTotal, lineNets, vatBreakdown };
}
