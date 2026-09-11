import { test } from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import {
  buildEpcPayload,
  isValidIban,
  normalizeIban,
  sanitizeEpcField,
  EPC_MAX_BYTES,
  type GirocodeInput,
} from "../lib/girocode";
import { encodeQrMatrix, qrMatrixToRuns } from "../lib/qr";

/**
 * Girocode (EPC069-12) payload + QR encoding.
 *
 * The decisive test is the round-trip at the bottom: a payload that a real
 * decoder cannot read back byte-for-byte would send a customer's money to the
 * wrong place, and no amount of string assertions would catch it.
 */

const VALID_IBAN = "DE89370400440532013000";

const input = (overrides: Partial<GirocodeInput> = {}): GirocodeInput => ({
  beneficiaryName: "Muster GmbH",
  iban: VALID_IBAN,
  bic: "COBADEFFXXX",
  amount: 119,
  currency: "EUR",
  remittanceInfo: "Rechnung RE-2026-001",
  ...overrides,
});

test("payload has the EPC field order and a trimmed tail", () => {
  const lines = buildEpcPayload(input())!.split("\n");
  assert.deepEqual(lines, [
    "BCD",
    "002",
    "1",
    "SCT",
    "COBADEFFXXX",
    "Muster GmbH",
    VALID_IBAN,
    "EUR119.00",
    "", // purpose code
    "", // structured creditor reference
    "Rechnung RE-2026-001",
    // beneficiary-to-originator info is empty and therefore omitted
  ]);
});

test("version 002 lets the BIC be empty without shifting later fields", () => {
  const lines = buildEpcPayload(input({ bic: undefined }))!.split("\n");
  assert.equal(lines[4], "");
  assert.equal(lines[6], VALID_IBAN);
});

test("IBAN is normalized; amount always carries two decimals", () => {
  const lines = buildEpcPayload(input({ iban: "de89 3704 0044 0532 0130 00", amount: 1234.5 }))!.split("\n");
  assert.equal(lines[6], VALID_IBAN);
  assert.equal(lines[7], "EUR1234.50");
});

test("amount is rounded to cents, not truncated", () => {
  const lines = buildEpcPayload(input({ amount: 19.005 }))!.split("\n");
  assert.equal(lines[7], "EUR19.01");
});

test("mod-97 accepts a real IBAN and rejects a transposed digit", () => {
  assert.equal(isValidIban(VALID_IBAN), true);
  assert.equal(isValidIban("DE89370400440532013001"), false);
  assert.equal(isValidIban("AT611904300234573201"), true);
  assert.equal(isValidIban("CH9300762011623852957"), true);
  assert.equal(isValidIban("DE8937040044053201300"), false); // one digit short
  assert.equal(isValidIban(""), false);
  assert.equal(normalizeIban(" de89 3704 "), "DE893704");
});

test("no QR for anything that must not be paid this way", () => {
  assert.equal(buildEpcPayload(input({ currency: "USD" })), null, "non-EUR");
  assert.equal(buildEpcPayload(input({ iban: "" })), null, "missing IBAN");
  assert.equal(buildEpcPayload(input({ iban: "DE89370400440532013001" })), null, "failed checksum");
  assert.equal(buildEpcPayload(input({ iban: "TR330006100519786457841326" })), null, "outside SEPA");
  assert.equal(buildEpcPayload(input({ beneficiaryName: "   " })), null, "empty payee");
  assert.equal(buildEpcPayload(input({ amount: 0 })), null, "zero amount");
  assert.equal(buildEpcPayload(input({ amount: -119 })), null, "negative amount");
  assert.equal(buildEpcPayload(input({ amount: 1_000_000_000 })), null, "above the EPC ceiling");
});

test("a newline in a company name cannot inject EPC fields", () => {
  // Without sanitizing, this would append an amount field of the attacker's
  // choosing and shift the IBAN into a different slot.
  const payload = buildEpcPayload(input({ beneficiaryName: "Muster GmbH\nEUR999999.99" }))!;
  const lines = payload.split("\n");
  assert.equal(lines[5], "Muster GmbH EUR999999.99");
  assert.equal(lines[6], VALID_IBAN);
  assert.equal(lines[7], "EUR119.00");
});

test("fields are truncated to their EPC limits", () => {
  assert.equal(sanitizeEpcField("x".repeat(100), 70).length, 70);
  const payload = buildEpcPayload(
    input({ beneficiaryName: "N".repeat(120), remittanceInfo: "R".repeat(200) })
  )!;
  const lines = payload.split("\n");
  assert.equal(lines[5].length, 70);
  assert.equal(lines[10].length, 140);
});

test("the reference gives way so an umlaut-heavy payload still fits 331 bytes", () => {
  // 70 umlaut characters are 140 bytes, so character-level truncation alone
  // would blow the byte cap and cost the customer their QR code.
  const payload = buildEpcPayload(
    input({ beneficiaryName: "Ä".repeat(70), remittanceInfo: "Ü".repeat(140) })
  );
  assert.notEqual(payload, null);
  assert.ok(new TextEncoder().encode(payload!).length <= EPC_MAX_BYTES);

  const lines = payload!.split("\n");
  assert.equal(lines[5], "Ä".repeat(70), "the payee name survives intact");
  assert.equal(lines[6], VALID_IBAN);
  assert.ok(lines[10].length < 140, "the reference was shortened instead");
  assert.ok(lines[10].length > 0);
});

test("matrix is square and run-merging preserves every dark module", () => {
  const matrix = encodeQrMatrix(buildEpcPayload(input())!);
  assert.ok(matrix.length >= 21);
  for (const row of matrix) assert.equal(row.length, matrix.length);

  const size = 72;
  const runs = qrMatrixToRuns(matrix, size, 0);
  const darkModules = matrix.flat().filter(Boolean).length;
  const moduleSize = size / matrix.length;
  const covered = runs.reduce((sum, run) => sum + Math.round(run.width / moduleSize), 0);
  assert.equal(covered, darkModules);
  // Nothing may spill outside the requested box.
  for (const run of runs) {
    assert.ok(run.x >= 0 && run.x + run.width <= size + 1e-9);
    assert.ok(run.y >= 0 && run.y + run.height <= size + 1e-9);
  }
});

test("a real decoder reads the payload back byte-for-byte, umlauts included", () => {
  const payload = buildEpcPayload(
    input({ beneficiaryName: "Müller & Söhne GmbH", remittanceInfo: "Rechnung RE-2026-001 Größe" })
  )!;
  const matrix = encodeQrMatrix(payload);

  // Render the matrix to an RGBA bitmap with the 4-module quiet zone the spec
  // requires, then decode it the way a banking app's camera would.
  const quiet = 4;
  const scale = 4;
  const n = matrix.length;
  const dim = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!matrix[row][col]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((row + quiet) * scale + dy) * dim + ((col + quiet) * scale + dx);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }

  const decoded = jsQR(data, dim, dim);
  assert.notEqual(decoded, null, "QR code could not be decoded");
  assert.equal(decoded!.data, payload);
});
