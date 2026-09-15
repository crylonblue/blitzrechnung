import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  validateApiKey,
  requireApiAccess,
  unauthorized,
  paymentRequired,
  forbidden,
  notFound,
  badRequest,
  serverError,
  type ApiAuth,
} from "../app/api/v1/_lib/auth";

/**
 * Zugang und Fehlerkontrakt der öffentlichen API.
 *
 * Diese Tests brauchen weder Datenbank noch laufenden Server: `validateApiKey`
 * verwirft ungültige Schlüssel vollständig, bevor es einen Supabase-Client
 * anlegt, und die Antwort-Helfer sind reine Funktionen.
 *
 * Getestet wird hier bewusst das, was Geld kostet, wenn es bricht: Wer darf
 * die API benutzen, und welche Form haben die Fehler, auf die Integrationen
 * der Kunden sich verlassen.
 */

function request(headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/v1/invoices", { headers });
}

// --- Schlüsselprüfung vor jedem Datenbankzugriff ----------------------------

test("ohne Authorization-Header wird abgelehnt", async () => {
  assert.equal(await validateApiKey(request()), null);
});

test("ein anderes Auth-Schema als Bearer wird abgelehnt", async () => {
  assert.equal(await validateApiKey(request({ authorization: "Basic flx_abc" })), null);
});

test("ein Bearer-Token ohne flx_-Präfix wird abgelehnt", async () => {
  assert.equal(await validateApiKey(request({ authorization: "Bearer sk_live_abc" })), null);
});

test("ein leeres Bearer-Token wird abgelehnt", async () => {
  assert.equal(await validateApiKey(request({ authorization: "Bearer " })), null);
});

test("das Präfix wird am Anfang geprüft, nicht irgendwo im Token", async () => {
  // Sonst käme "irgendwas_flx_..." durch und würde gegen die Datenbank laufen.
  assert.equal(await validateApiKey(request({ authorization: "Bearer xflx_abc" })), null);
});

// --- Tarifprüfung ----------------------------------------------------------

const auth = (over: Partial<ApiAuth> = {}): ApiAuth => ({
  companyId: "c1",
  userId: "u1",
  entitled: true,
  isPro: true,
  ...over,
});

test("abgelaufene Testphase wird mit 402 abgewiesen", async () => {
  const res = requireApiAccess(auth({ entitled: false, isPro: false }));
  assert.ok(res, "es muss eine Fehlerantwort kommen");
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.code, "PAYMENT_REQUIRED");
  assert.match(body.error, /trial/i);
});

test("Basis-Tarif erhält keinen API-Zugang", async () => {
  // Entscheidend fürs Geschäftsmodell: API ist ein Pro-Merkmal. Wäre das
  // umgekehrt, bekäme jeder Basis-Kunde die API geschenkt.
  const res = requireApiAccess(auth({ entitled: true, isPro: false }));
  assert.ok(res);
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /Pro/);
});

test("Pro-Tarif wird durchgelassen", () => {
  assert.equal(requireApiAccess(auth()), null);
});

test("laufende Testphase zählt als Pro", () => {
  // getBillingState setzt im Trial isPro=true — die Tarifprüfung darf einen
  // Testkunden also nicht aussperren.
  assert.equal(requireApiAccess(auth({ entitled: true, isPro: true })), null);
});

// --- Fehlerkontrakt --------------------------------------------------------

test("Fehlerantworten haben stabile Statuscodes und Fehlercodes", async () => {
  // Integrationen der Kunden werten diese Codes aus. Ändert sich hier etwas,
  // brechen fremde Systeme — deshalb festgenagelt.
  const cases: Array<[Response, number, string]> = [
    [unauthorized(), 401, "UNAUTHORIZED"],
    [paymentRequired("x"), 402, "PAYMENT_REQUIRED"],
    [forbidden(), 403, "FORBIDDEN"],
    [notFound(), 404, "NOT_FOUND"],
    [badRequest("x"), 400, "VALIDATION_ERROR"],
    [serverError(), 500, "SERVER_ERROR"],
  ];

  for (const [res, status, code] of cases) {
    assert.equal(res.status, status, `Status für ${code}`);
    const body = await res.json();
    assert.equal(body.code, code);
    assert.equal(typeof body.error, "string");
    assert.ok(body.error.length > 0, `${code} braucht eine Fehlermeldung`);
  }
});

test("notFound benennt die Ressource", async () => {
  const body = await notFound("Invoice").json();
  assert.equal(body.error, "Invoice not found");
});
