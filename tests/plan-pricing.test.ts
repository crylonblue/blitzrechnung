import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDisplayPrice,
  intervalSuffix,
  type PlanPricing,
  type PriceInfo,
  type Plan,
  type Interval,
} from "../lib/plan-pricing";

/**
 * Tarifauswahl — angezeigter und abgerechneter Preis müssen übereinstimmen.
 *
 * Hintergrund: Bis September 2026 lag über den Pro-Preisen ein Launch-Angebot
 * mit 100 Plätzen. Die Tarifauswahl zeigte es auch bei Jahresauswahl an,
 * während der Checkout den regulären Jahrespreis abrechnete — ein Kunde las
 * 5,00 €/Monat, erwartete 60,00 € fürs Jahr und zahlte 96,00 €.
 *
 * Das Angebot ist inzwischen der reguläre Preis, die Sonderregel entfallen.
 * Der Kreuzvergleich unten bleibt: Er ist der Schutz davor, dass Anzeige und
 * Abrechnung je wieder getrennte Wege gehen, egal aus welchem Anlass.
 *
 * Die Beträge sind die echten aus dem Stripe-Konto.
 */

const preis = (
  id: string,
  euro: number,
  interval: Interval,
  intervalCount = 1
): PriceInfo => ({
  id,
  unitAmount: Math.round(euro * 100),
  currency: "eur",
  interval,
  intervalCount,
});

const PRICING: PlanPricing = {
  basisMonthly: preis("price_basis_m", 4, "month"),
  basisYearly: preis("price_basis_y", 38.4, "year"),
  proMonthly: preis("price_pro_m", 5, "month"),
  proYearly: preis("price_pro_y", 60, "year"),
};

// --- Preisauswahl ----------------------------------------------------------

test("jeder Tarif folgt dem gewählten Intervall", () => {
  assert.equal(resolveDisplayPrice(PRICING, "basis", "month")?.id, "price_basis_m");
  assert.equal(resolveDisplayPrice(PRICING, "basis", "year")?.id, "price_basis_y");
  assert.equal(resolveDisplayPrice(PRICING, "pro", "month")?.id, "price_pro_m");
  assert.equal(resolveDisplayPrice(PRICING, "pro", "year")?.id, "price_pro_y");
});

test("Pro jährlich zeigt 60,00 €", () => {
  // Der Betrag, den Kunden vor der Umstellung erwartet und nicht bekommen haben.
  assert.equal(resolveDisplayPrice(PRICING, "pro", "year")?.unitAmount, 6000);
});

test("fehlt ein Preis, wird nichts erfunden", () => {
  const luecke: PlanPricing = { ...PRICING, proYearly: null };
  assert.equal(resolveDisplayPrice(luecke, "pro", "year"), null);
});

// --- Anzeige und Abrechnung dürfen nie auseinanderlaufen -------------------

/**
 * Der eigentliche Schutz: Was die Tarifauswahl anzeigt, muss exakt der Preis
 * sein, den der Checkout belastet — über alle Kombinationen hinweg.
 */
test("die angezeigte Preis-ID ist die, die der Checkout abrechnet", async () => {
  process.env.STRIPE_PRICE_BASIS_MONTHLY = "price_basis_m";
  process.env.STRIPE_PRICE_BASIS_YEARLY = "price_basis_y";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";

  const { resolvePriceId } = await import("../lib/stripe");

  const plans: Plan[] = ["basis", "pro"];
  const intervals: Interval[] = ["month", "year"];

  for (const plan of plans) {
    for (const interval of intervals) {
      const angezeigt = resolveDisplayPrice(PRICING, plan, interval);
      const abgerechnet = resolvePriceId(plan, interval);
      assert.equal(
        angezeigt?.id,
        abgerechnet,
        `${plan}/${interval}: angezeigt ${angezeigt?.id}, abgerechnet ${abgerechnet}`
      );
    }
  }
});

test("jeder abrechenbare Preis gewährt auch einen Tarif", async () => {
  // Erkennt der Webhook eine Preis-ID nicht, schreibt er plan='none' — der
  // Kunde hätte bezahlt und keinen Zugang. Das darf für keinen Preis gelten,
  // den der Checkout überhaupt anbieten kann.
  process.env.STRIPE_PRICE_BASIS_MONTHLY = "price_basis_m";
  process.env.STRIPE_PRICE_BASIS_YEARLY = "price_basis_y";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";

  const { resolvePriceId, planForPriceId } = await import("../lib/stripe");

  for (const plan of ["basis", "pro"] as Plan[]) {
    for (const interval of ["month", "year"] as Interval[]) {
      const id = resolvePriceId(plan, interval);
      assert.equal(planForPriceId(id), plan, `${plan}/${interval} (${id})`);
    }
  }
});

// --- Beschriftung folgt Stripe, nicht dem Umschalter -----------------------

test("ein Monatspreis wird nie als Jahrespreis beschriftet", () => {
  // Zeigt eine *_YEARLY-Variable versehentlich auf einen Monatspreis, muss die
  // Oberfläche das sagen statt "/ Jahr" zu behaupten.
  assert.equal(intervalSuffix(preis("x", 8, "month"), "year"), "/ Monat");
});

test("Beschriftung folgt dem echten Intervall", () => {
  assert.equal(intervalSuffix(PRICING.proYearly, "month"), "/ Jahr");
  assert.equal(intervalSuffix(PRICING.proMonthly, "year"), "/ Monat");
});

test("mehrperiodige Preise werden korrekt benannt", () => {
  assert.equal(intervalSuffix(preis("q", 25, "month", 3), "month"), "/ 3 Monate");
});

test("ohne Preis fällt die Beschriftung auf das gewählte Intervall zurück", () => {
  assert.equal(intervalSuffix(null, "year"), "/ Jahr");
  assert.equal(intervalSuffix(null, "month"), "/ Monat");
});
