import { test } from "node:test";
import assert from "node:assert/strict";
import { generateInvoiceEmail } from "../lib/email-templates";
import { getTranslations } from "../lib/invoice-translations";
import type { Invoice, PartySnapshot } from "../types";

/**
 * Die vorbelegte Versand-E-Mail — Rückmeldung einer Kundin: Zu einer
 * englischen Rechnung kam der Mailtext immer auf Deutsch, und eine
 * Stornorechnung wurde als „Rechnung … über -317,02 €" angekündigt.
 */

const KAEUFER: PartySnapshot = {
  name: "Mandel GmbH",
  address: { street: "Hauptstr.", streetnumber: "3", city: "Köln", zip: "50667", country: "DE" },
};

const beleg = (over: Partial<Invoice> = {}): Invoice =>
  ({
    invoice_number: "RE-2026-0042",
    invoice_date: "2026-10-01",
    total_amount: 317.02,
    language: "de",
    invoice_type: "invoice",
    ...over,
  }) as Invoice;

test("Rechnungsmail folgt der Sprache der Rechnung", () => {
  const de = generateInvoiceEmail(beleg(), KAEUFER, { mode: "default" });
  assert.equal(de.subject, "Rechnung RE-2026-0042");
  assert.match(de.body, /anbei erhalten Sie Rechnung RE-2026-0042/);

  const en = generateInvoiceEmail(beleg({ language: "en" }), KAEUFER, { mode: "default" });
  assert.equal(en.subject, "Invoice RE-2026-0042");
  assert.match(en.body, /^Dear Sir or Madam,/);
  assert.match(en.body, /please find attached invoice RE-2026-0042 for €317\.02/);
});

test("Stornorechnung kündigt sich als Storno an, nicht als Rechnung über einen negativen Betrag", () => {
  const storno = beleg({ invoice_type: "cancellation", invoice_number: "ST-2026-0003", total_amount: -317.02 });
  // auch eine eigene Rechnungsvorlage der Firma greift beim Storno nicht
  const settings = { mode: "default" as const, invoice_email_subject: "Ihre Rechnung {invoice_number}", invoice_email_body: "Betrag: {total_amount}" };

  const de = generateInvoiceEmail(storno, KAEUFER, settings, "RE-2026-0042");
  assert.equal(de.subject, "Stornorechnung ST-2026-0003");
  assert.match(de.body, /Stornorechnung ST-2026-0003 zur Stornierung der Rechnung RE-2026-0042/);
  assert.doesNotMatch(de.body, /317/);

  const en = generateInvoiceEmail({ ...storno, language: "en" }, KAEUFER, settings, "RE-2026-0042");
  assert.equal(en.subject, "Cancellation Invoice ST-2026-0003");
  assert.match(en.body, /cancellation invoice ST-2026-0003 for the cancellation of invoice RE-2026-0042/);
});

test("Einleitung der Stornorechnung je Sprache", () => {
  assert.equal(
    getTranslations("de").cancellationIntroText("RE-2026-0042", "01.10.2026"),
    "hiermit stornieren wir unsere Rechnung RE-2026-0042 vom 01.10.2026 in voller Höhe."
  );
  assert.equal(
    getTranslations("en").cancellationIntroText("RE-2026-0042", "10/01/2026"),
    "We hereby cancel our invoice RE-2026-0042 dated 10/01/2026 in full."
  );
});
