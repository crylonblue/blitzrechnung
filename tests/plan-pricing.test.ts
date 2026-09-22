import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earlyBirdApplies,
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
 * Hintergrund: Das Launch-Angebot ist ein Monatspreis (5,00 €) ohne
 * Jahres-Pendant. Die Tarifauswahl zeigte es trotzdem an, wenn "Jährlich"
 * gewählt war, während der Checkout den reguläeren Jahrespreis abrechnete. Ein
 * Kunde las 5,00 €/Monat, erwartete 60,00 € fürs Jahr und zahlte 96,00 €.
 *
 * Die Beträge unten sind die echten aus dem Stripe-Konto.
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
  proMonthly: preis("price_pro_m", 10, "month"),
  proYearly: preis("price_pro_y", 96, "year"),
  proEarly: preis("price_pro_early", 5, "month"),
};

// --- Wann das Launch-Angebot gilt ------------------------------------------

test("Launch-Angebot gilt für Pro monatlich", () => {
  assert.equal(earlyBirdApplies("pro", "month", true), true);
});

test("Launch-Angebot gilt NICHT für Pro jährlich", () => {
  // Der Kern des Fehlers: Es gibt keinen Jahres-Launchpreis, also darf auch
  // keiner angezeigt werden.
  assert.equal(earlyBirdApplies("pro", "year", true), false);
});

test("Launch-Angebot gilt nicht für Basis", () => {
  assert.equal(earlyBirdApplies("basis", "month", true), false);
  assert.equal(earlyBirdApplies("basis", "year", true), false);
});

test("ohne freie Plätze gilt das Launch-Angebot nirgends", () => {
  assert.equal(earlyBirdApplies("pro", "month", false), false);
});

// --- Der eigentliche Regressionsfall ---------------------------------------

test("Pro jährlich zeigt 96,00 € — nicht den Launch-Preis", () => {
  const price = resolveDisplayPrice(PRICING, "pro", "year", true);
  assert.equal(price?.id, "price_pro_y");
  assert.equal(price?.unitAmount, 9600);
});

test("Pro monatlich zeigt den Launch-Preis, solange Plätze frei sind", () => {
  const price = resolveDisplayPrice(PRICING, "pro", "month", true);
  assert.equal(price?.id, "price_pro_early");
  assert.equal(price?.unitAmount, 500);
});

test("Pro monatlich zeigt den regulären Preis, wenn keine Plätze frei sind", () => {
  const price = resolveDisplayPrice(PRICING, "pro", "month", false);
  assert.equal(price?.id, "price_pro_m");
});

test("Basis folgt immer dem gewählten Intervall", () => {
  assert.equal(resolveDisplayPrice(PRICING, "basis", "month", true)?.id, "price_basis_m");
  assert.equal(resolveDisplayPrice(PRICING, "basis", "year", true)?.id, "price_basis_y");
});

// --- Anzeige und Abrechnung dürfen nie auseinanderlaufen -------------------

test("die angezeigte Preis-ID ist die, die der Checkout abrechnet", async () => {
  // resolvePriceId liest die IDs aus der Umgebung; hier auf dieselben Werte
  // gesetzt wie in PRICING, damit beide Seiten vergleichbar sind.
  process.env.STRIPE_PRICE_BASIS_MONTHLY = "price_basis_m";
  process.env.STRIPE_PRICE_BASIS_YEARLY = "price_basis_y";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
  process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";
  process.env.STRIPE_PRICE_PRO_EARLY = "price_pro_early";

  const { resolvePriceId } = await import("../lib/stripe");

  const plans: Plan[] = ["basis", "pro"];
  const intervals: Interval[] = ["month", "year"];

  for (const plan of plans) {
    for (const interval of intervals) {
      for (const earlyBird of [true, false]) {
        const angezeigt = resolveDisplayPrice(PRICING, plan, interval, earlyBird);
        const abgerechnet = resolvePriceId(plan, interval, earlyBird);
        assert.equal(
          angezeigt?.id,
          abgerechnet,
          `${plan}/${interval}/earlyBird=${earlyBird}: angezeigt ${angezeigt?.id}, abgerechnet ${abgerechnet}`
        );
      }
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
