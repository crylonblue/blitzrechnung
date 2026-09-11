/**
 * Girocode / EPC QR-Code payload construction (EPC069-12, "Quick Response Code:
 * Guidelines to Enable the Data Capture for the Initiation of a SEPA Credit
 * Transfer").
 *
 * The payload is a line-separated block of up to 12 fields. A banking app scans
 * it and pre-fills a SEPA credit transfer with payee, IBAN and amount, so the
 * customer never retypes an IBAN.
 *
 * This module is pure: it either returns a spec-conformant payload or `null`.
 * `null` means "do not print a QR code" — a code that resolves to the wrong
 * account, the wrong amount or a cancelled invoice is far worse than no code,
 * so every uncertainty here is resolved by omitting it.
 */

/** EPC069-12: the whole payload must not exceed 331 bytes. */
export const EPC_MAX_BYTES = 331

const MAX_NAME_CHARS = 70
const MAX_REMITTANCE_CHARS = 140
const MIN_AMOUNT = 0.01
const MAX_AMOUNT = 999_999_999.99

/**
 * Countries whose IBANs are reachable via the SEPA Credit Transfer scheme.
 * An IBAN outside this list cannot be paid by the scheme the QR code encodes.
 */
const SEPA_COUNTRIES = new Set([
  'AD', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU',
  'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM',
  'VA',
])

/** Uppercase, strip every kind of whitespace. "de89 3704 …" -> "DE893704…" */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase()
}

/**
 * ISO 7064 mod-97-10 check, the same one a bank runs. Catches transposed digits
 * and typos that a format regex happily accepts.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw)
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false

  // Move the first four characters to the end, then map letters to 10..35.
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const value = char >= 'A' && char <= 'Z' ? char.charCodeAt(0) - 55 : Number(char)
    // Fold digit by digit: the full number is far beyond Number.MAX_SAFE_INTEGER.
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97
  }
  return remainder === 1
}

/**
 * Make a user-supplied string safe for one EPC field.
 *
 * Stripping line breaks is not cosmetic: the payload is line-separated, so a
 * newline inside a company name would inject extra EPC fields and change what
 * the customer's banking app is told to pay.
 */
export function sanitizeEpcField(raw: string, maxChars: number): string {
  const cleaned = raw
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars).trim() : cleaned
}

/**
 * Cut a string to fit a byte budget without splitting a character in half.
 *
 * The EPC field limits are counted in characters but the 331-byte cap is
 * counted in bytes, and in UTF-8 a German name is not one byte per character.
 * "Müller" is 7 bytes, not 6.
 */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= maxBytes) return value
  let result = ''
  let used = 0
  for (const char of value) {
    const size = encoder.encode(char).length
    if (used + size > maxBytes) break
    result += char
    used += size
  }
  return result.trim()
}

/** EPC amounts are always "EUR" + a plain dot-decimal figure, e.g. EUR119.00 */
function formatEpcAmount(amount: number): string | null {
  const rounded = Math.round(amount * 100) / 100
  if (!Number.isFinite(rounded) || rounded < MIN_AMOUNT || rounded > MAX_AMOUNT) return null
  return `EUR${rounded.toFixed(2)}`
}

export interface GirocodeInput {
  /** Account holder if known, otherwise the seller's name. */
  beneficiaryName: string
  iban: string
  bic?: string
  /** Gross total — what the customer actually owes. */
  amount: number
  /** ISO 4217; anything but EUR cannot be encoded by the SCT scheme. */
  currency: string
  /** Verwendungszweck, e.g. "Rechnung RE-2026-001". */
  remittanceInfo: string
}

/**
 * Build the EPC069-12 payload, or return `null` when this invoice must not
 * carry a Girocode.
 */
export function buildEpcPayload(input: GirocodeInput): string | null {
  if (input.currency?.toUpperCase() !== 'EUR') return null

  const iban = normalizeIban(input.iban ?? '')
  if (!isValidIban(iban)) return null
  if (!SEPA_COUNTRIES.has(iban.slice(0, 2))) return null

  const name = sanitizeEpcField(input.beneficiaryName ?? '', MAX_NAME_CHARS)
  if (!name) return null

  const amount = formatEpcAmount(input.amount)
  if (!amount) return null

  const bic = sanitizeEpcField(input.bic ?? '', 11).replace(/[^A-Z0-9]/gi, '').toUpperCase()
  let remittance = sanitizeEpcField(input.remittanceInfo ?? '', MAX_REMITTANCE_CHARS)

  // Everything except the remittance is load-bearing, so when the payload would
  // breach the 331-byte cap the reference text is what gives way — a shortened
  // Verwendungszweck is a far better outcome than no QR code at all.
  const fixedBytes = new TextEncoder().encode(
    ['BCD', '002', '1', 'SCT', bic, name, iban, amount, '', '', ''].join('\n')
  ).length
  if (fixedBytes + new TextEncoder().encode(remittance).length > EPC_MAX_BYTES) {
    remittance = truncateToBytes(remittance, Math.max(0, EPC_MAX_BYTES - fixedBytes))
  }

  const lines = [
    'BCD',           // service tag
    '002',           // version 002 — lets us omit the BIC, which is optional inside the EEA
    '1',             // character set 1 = UTF-8, so umlauts in a company name survive
    'SCT',           // SEPA Credit Transfer
    bic,             // BIC (optional in version 002)
    name,            // beneficiary name
    iban,            // beneficiary account
    amount,          // EUR<amount>
    '',              // purpose code — intentionally unset
    '',              // structured creditor reference (mutually exclusive with the next line)
    remittance,      // unstructured remittance information
    '',              // beneficiary-to-originator information
  ]

  // Trailing empty fields may be omitted; doing so keeps us well inside the cap.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const payload = lines.join('\n')
  if (new TextEncoder().encode(payload).length > EPC_MAX_BYTES) return null
  return payload
}
