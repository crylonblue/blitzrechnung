import { test } from "node:test";
import assert from "node:assert/strict";
import { validateXRechnungInvoice } from "../lib/schema";
import { makeInvoice } from "./helpers";

/**
 * XRechnung field-level validation: the electronic addresses (BT-34 seller,
 * BT-49 buyer) are mandatory and must hard-block finalization, not just warn.
 */

test("valid invoice passes XRechnung validation", () => {
  const res = validateXRechnungInvoice(makeInvoice());
  assert.equal(res.valid, true, res.errors.join("; "));
});

test("BT-49: missing buyer email is an error, not a warning", () => {
  const inv = makeInvoice({
    customer: {
      name: "Kunde AG",
      address: { street: "Kundenweg", streetNumber: "2", postalCode: "20095", city: "Hamburg", country: "DE" },
      additionalInfo: undefined, // no email
    },
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("BT-49")), `expected BT-49 error, got: ${res.errors.join("; ")}`);
});

test("BT-34: missing seller email is an error", () => {
  const inv = makeInvoice({
    seller: {
      name: "Muster GmbH",
      address: { street: "Hauptstr", streetNumber: "1", postalCode: "10707", city: "Berlin", country: "DE" },
      taxNumber: "30/123/45678",
      vatId: "DE123456789",
      contact: { name: "Max Muster", phone: "030123" }, // no email
      // no top-level seller.email either
    },
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes("BT-34")), `expected BT-34 error, got: ${res.errors.join("; ")}`);
});

test("seller email falls back to top-level seller.email", () => {
  const inv = makeInvoice({
    seller: {
      name: "Muster GmbH",
      address: { street: "Hauptstr", streetNumber: "1", postalCode: "10707", city: "Berlin", country: "DE" },
      taxNumber: "30/123/45678",
      vatId: "DE123456789",
      email: "info@muster.de", // top-level, no contact email
      contact: { name: "Max Muster", phone: "030123" },
    },
  });
  const res = validateXRechnungInvoice(inv);
  assert.equal(res.valid, true, res.errors.join("; "));
});
