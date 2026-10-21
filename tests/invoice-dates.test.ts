import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInvoiceDates, validateInvoiceForFinalization } from "../lib/invoice-validation";

/**
 * Plausibilität der Datumsangaben eines Entwurfs.
 *
 * Ein Fälligkeitsdatum vor dem Rechnungsdatum ist immer falsch — daran hängen
 * Zahlungsziel, Verzug und Mahnfristen. Es ist aber kein §-14-Pflichtfeld und
 * darf das Fertigstellen deshalb nicht sperren: Der Hinweis ist ein Hinweis,
 * und genau das sichern diese Tests in beide Richtungen ab.
 */

test("Fälligkeitsdatum vor dem Rechnungsdatum wird beanstandet", () => {
  // Der Fall aus dem E2E-Durchlauf: Rechnung vom 03.08., fällig am 17.07.
  const warnings = validateInvoiceDates({ invoiceDate: "2026-08-03", dueDate: "2026-07-17" });
  assert.equal(warnings.length, 1, `erwartet: ein Hinweis, erhalten: ${JSON.stringify(warnings)}`);
  assert.equal(warnings[0].field, "dueDate");
  assert.match(warnings[0].message, /Fälligkeitsdatum liegt vor dem Rechnungsdatum/);
});

test("Fälligkeitsdatum gleich dem Rechnungsdatum ist legitim ('zahlbar sofort')", () => {
  const warnings = validateInvoiceDates({ invoiceDate: "2026-08-03", dueDate: "2026-08-03" });
  assert.deepEqual(warnings, []);
});

test("Fälligkeitsdatum nach dem Rechnungsdatum ist der Normalfall", () => {
  const warnings = validateInvoiceDates({ invoiceDate: "2026-08-03", dueDate: "2026-08-17" });
  assert.deepEqual(warnings, []);
});

test("Jahreswechsel: 02.01. fällig vor 28.12. wird erkannt", () => {
  // Stellt sicher, dass wirklich chronologisch verglichen wird und nicht nur
  // Tag oder Monat.
  const warnings = validateInvoiceDates({ invoiceDate: "2027-01-02", dueDate: "2026-12-28" });
  assert.equal(warnings.length, 1);
});

test("fehlende Angaben lösen keinen Hinweis aus", () => {
  assert.deepEqual(validateInvoiceDates({ invoiceDate: "2026-08-03", dueDate: null }), []);
  assert.deepEqual(validateInvoiceDates({ invoiceDate: null, dueDate: "2026-07-17" }), []);
  assert.deepEqual(validateInvoiceDates({ invoiceDate: null, dueDate: null }), []);
});

test("der Hinweis sperrt das Fertigstellen nicht", () => {
  // Gegenprobe zur Entscheidung "Hinweis statt Riegel": Eine im Übrigen
  // vollständige Rechnung mit verdrehten Daten muss weiterhin fertigstellbar
  // sein — sonst wäre aus dem Hinweis unbemerkt eine Sperre geworden.
  const result = validateInvoiceForFinalization({
    company: {
      name: "Muster GmbH",
      address: {
        street: "Hauptstr",
        streetnumber: "1",
        zip: "10707",
        city: "Berlin",
        country: "DE",
      },
      tax_id: "30/123/45678",
      vat_id: "DE123456789",
      bank_details: { iban: "DE02120300000000202051", bank_name: "Testbank" },
      contact_email: "rechnung@muster.de",
    } as never,
    issuerSnapshot: null,
    customerSnapshot: {
      name: "Kunde AG",
      email: "buchhaltung@kunde.de",
      address: {
        street: "Kundenweg",
        streetnumber: "2",
        zip: "20095",
        city: "Hamburg",
        country: "DE",
      },
    } as never,
    lineItems: [
      {
        description: "Beratung",
        quantity: 1,
        unit: "Stk",
        unit_price: 100,
        vat_rate: 19,
        total: 100,
      } as never,
    ],
    invoiceDate: "2026-08-03",
    useDefaultIssuer: true,
  });

  assert.equal(result.isValid, true, result.errors.map((e) => e.message).join("; "));
  assert.equal(
    result.errors.some((e) => e.field === "dueDate"),
    false,
    "das Fälligkeitsdatum darf nicht in die Fertigstellungsprüfung wandern"
  );
});
