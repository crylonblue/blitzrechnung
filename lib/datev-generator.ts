import iconv from "iconv-lite";
import { computeInvoiceTotals, round2, type TotalsLineInput } from "./invoice-totals";
import type { TaxCategory } from "./schema";

/**
 * DATEV-Format (EXTF) "Buchungsstapel" generator.
 *
 * Produces the booking-batch CSV a tax advisor imports into DATEV: one booking
 * record per VAT group of each invoice (Debitor an Erlöskonto), using the
 * automatic SKR revenue accounts so DATEV derives the VAT itself.
 *
 * NOTE: the EXTF format is strict about field order and Windows-1252 encoding.
 * The structure here follows the published EXTF v700 Buchungsstapel layout, but
 * the authoritative validation is a real DATEV import — see tests/datev.test.ts
 * and the plan's verification section.
 */

export type SkrVariant = "SKR03" | "SKR04";

export interface DatevSettings {
  skr: SkrVariant;
  berater_nr: string;
  mandanten_nr: string;
  /** Wirtschaftsjahresbeginn as 'MMDD' (default '0101'). */
  wj_beginn?: string;
  /** Sachkontenlänge (default 4). */
  sachkontenlaenge?: number;
  /** Debitoren-Sammelkonto (default '10000'). */
  debitor_konto: string;
  erloes_konten: {
    standard19: string;
    standard7: string;
    steuerfrei: string;
    nullsatz: string;
  };
}

/** Standard revenue accounts per chart of accounts, used to pre-fill settings. */
export const DATEV_ACCOUNT_DEFAULTS: Record<
  SkrVariant,
  DatevSettings["erloes_konten"] & { debitor_konto: string }
> = {
  SKR03: { standard19: "8400", standard7: "8300", steuerfrei: "8100", nullsatz: "8200", debitor_konto: "10000" },
  SKR04: { standard19: "4400", standard7: "4300", steuerfrei: "4100", nullsatz: "4200", debitor_konto: "10000" },
};

export interface DatevLineItem {
  quantity: number;
  unit_price: number;
  vat_rate: number;
  tax_category?: TaxCategory;
  exemption_reason?: string;
}

export interface DatevInvoice {
  invoice_number: string;
  invoice_date: string; // ISO 'YYYY-MM-DD'
  invoice_type: "invoice" | "cancellation";
  buyer_name: string;
  line_items: DatevLineItem[];
}

export interface DatevResult {
  /** Windows-1252 encoded CSV ready to stream as a file. */
  content: Buffer;
  bookingCount: number;
  skipped: { invoiceNumber: string; reason: string }[];
}

// ── formatting helpers ───────────────────────────────────────────────────────
const amount = (x: number) => (Math.round(x * 100) / 100).toFixed(2).replace(".", ","); // 1190,00
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`; // '2026-05-31' -> '3105'
const ymd = (iso: string) => iso.replace(/-/g, ""); // '2026-05-31' -> '20260531'
/** DATEV escapes a double quote by doubling it. */
const q = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;

/** 14 standard Buchungsstapel columns in fixed order; only some are populated. */
const COLUMN_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
];

function revenueAccount(category: TaxCategory, rate: number, s: DatevSettings): string {
  if (category === "E") return s.erloes_konten.steuerfrei;
  if (category === "Z") return s.erloes_konten.nullsatz;
  // category "S" (standard-rated): map by rate, fall back to the 19% account.
  return rate === 7 ? s.erloes_konten.standard7 : s.erloes_konten.standard19;
}

export function generateDatevBuchungsstapel(
  invoices: DatevInvoice[],
  settings: DatevSettings,
  range: { from: string; to: string }, // ISO dates
  now: Date
): DatevResult {
  const skipped: { invoiceNumber: string; reason: string }[] = [];
  const dataRows: string[] = [];

  for (const inv of invoices) {
    const lines: TotalsLineInput[] = inv.line_items.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unit_price,
      vatRate: li.vat_rate,
      taxCategory: li.tax_category,
      exemptionReason: li.exemption_reason,
    }));

    // Reverse charge (§13b) needs a different booking — out of scope for v1.
    if (lines.some((l) => l.taxCategory === "AE")) {
      skipped.push({ invoiceNumber: inv.invoice_number, reason: "Reverse Charge (§13b) wird noch nicht exportiert" });
      continue;
    }

    const isCancellation = inv.invoice_type === "cancellation";
    const { vatBreakdown } = computeInvoiceTotals(lines);

    for (const g of vatBreakdown) {
      const gross = round2(g.basisAmount + g.taxAmount);
      if (gross === 0) continue;
      const cols = new Array(COLUMN_HEADERS.length).fill("");
      cols[0] = amount(Math.abs(gross)); // Umsatz (always positive; sign via S/H)
      cols[1] = q(isCancellation ? "H" : "S"); // Soll/Haben (Storno reverses the receivable)
      cols[2] = q("EUR");
      cols[6] = settings.debitor_konto; // Konto = Debitoren-Sammelkonto
      cols[7] = revenueAccount(g.category, g.rate, settings); // Gegenkonto = Erlöskonto
      // cols[8] BU-Schlüssel stays empty — automatic SKR accounts derive the VAT.
      cols[9] = ddmm(inv.invoice_date); // Belegdatum (TTMM)
      cols[10] = q(inv.invoice_number); // Belegfeld 1
      cols[13] = q(inv.buyer_name); // Buchungstext
      dataRows.push(cols.join(";"));
    }
  }

  const stamp =
    ymd(now.toISOString().slice(0, 10)) +
    now.toISOString().slice(11, 19).replace(/:/g, "") +
    "000"; // YYYYMMDDHHMMSSFFF
  const wjBeginn = `${range.from.slice(0, 4)}${settings.wj_beginn || "0101"}`; // YYYYMMDD

  // Header line — EXTF v700, Datenkategorie 21 (Buchungsstapel), Formatversion 13.
  const header = [
    q("EXTF"), "700", "21", q("Buchungsstapel"), "13",
    stamp, "", "", "", "",
    settings.berater_nr, settings.mandanten_nr,
    wjBeginn, String(settings.sachkontenlaenge || 4),
    ymd(range.from), ymd(range.to),
    q("Blitzrechnung"), "", "1", "0", "0", q("EUR"),
    "", "", "", "", "", "", "", "", "",
  ].join(";");

  const columnLine = COLUMN_HEADERS.map(q).join(";");
  const csv = [header, columnLine, ...dataRows].join("\r\n") + "\r\n";

  return {
    content: iconv.encode(csv, "win1252"),
    bookingCount: dataRows.length,
    skipped,
  };
}
