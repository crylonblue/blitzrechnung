import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earlyBirdApplies,
  earlyBirdPrice,
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
 * Hintergrund: Das Launch-Angebot war ein reiner Monatspreis (5,00 €). Die
 * Tarifauswahl zeigte es trotzdem an, wenn "Jährlich" gewählt war, während der
 * Checkout den regulären Jahrespreis abrechnete. Ein Kunde las 5,00 €/Monat,
 * erwartete 60,00 € fürs Jahr und zahlte 96,00 €.
 *
 * Welche Intervalle das Angebot abdeckt, steht seitdem nicht mehr im Code,
 * sondern folgt daraus, welche Launch-Preise in Stripe hinterlegt sind.
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

/** Launch-Angebot nur monatlich — der Stand vor dem Jahrespreis. */
const NUR_MONATLICH: PlanPricing = {
  basisMonthly: preis("price_basis_m", 4, "month"),
  basisYearly: preis("price_basis_y", 38.4, "year"),
  proMonthly: preis("price_pro_m", 10, "month"),
  proYearly: preis("price_pro_y", 96, "year"),
  proEarly: preis("price_pro_early", 5, "month"),
  proEarlyYearly: null,
};

/** Launch-Angebot für beide Intervalle. */
const BEIDE: PlanPricing = {
  ...NUR_MONATLICH,
  proEarlyYearly: preis("price_pro_early_y", 60, "year"),
};

// --- Wann das Launch-Angebot gilt ------------------------------------------

test("Launch-Angebot gilt für Pro monatlich", () => {
  assert.equal(earlyBirdApplies("pro", "month", true, true), true);
});

test("ohne Launch-Preis für das Intervall gilt es nicht", () => {
  // Der ursprüngliche Fehlerfall: jährlich gewählt, aber kein Jahres-Launchpreis.
  assert.equal(earlyBirdApplies("pro", "year", true, false), false);
});

test("mit Jahres-Launchpreis gilt es auch jährlich", () => {
  assert.equal(earlyBirdApplies("pro", "year", true, true), true);
});

test("Launch-Angebot gilt nie für Basis", () => {
  assert.equal(earlyBirdApplies("basis", "month", true, true), false);
  assert.equal(earlyBirdApplies("basis", "year", true, true), false);
});

test("ohne freie Plätze gilt das Launch-Angebot nirgends", () => {
  assert.equal(earlyBirdApplies("pro", "month", false, true), false);
  assert.equal(earlyBirdApplies("pro", "year", false, true), false);
});

// --- Der ursprüngliche Regressionsfall -------------------------------------

test("ohne Jahres-Launchpreis zeigt Pro jährlich 96,00 € statt 5,00 €", () => {
  const price = resolveDisplayPrice(NUR_MONATLICH, "pro", "year", true);
  assert.equal(price?.id, "price_pro_y");
  assert.equal(price?.unitAmount, 9600);
});

// --- Das neue Verhalten ----------------------------------------------------

test("mit Jahres-Launchpreis zeigt Pro jährlich 60,00 €", () => {
  const price = resolveDisplayPrice(BEIDE, "pro", "year", true);
  assert.equal(price?.id, "price_pro_early_y");
  assert.equal(price?.unitAmount, 6000);
});

test("Pro monatlich zeigt weiterhin den monatlichen Launch-Preis", () => {
  assert.equal(resolveDisplayPrice(BEIDE, "pro", "month", true)?.id, "price_pro_early");
});

test("sind die Plätze weg, gilt überall der reguläre Preis", () => {
  assert.equal(resolveDisplayPrice(BEIDE, "pro", "month", false)?.id, "price_pro_m");
  assert.equal(resolveDisplayPrice(BEIDE, "pro", "year", false)?.id, "price_pro_y");
});

test("Basis folgt immer dem gewählten Intervall", () => {
  for (const pricing of [NUR_MONATLICH, BEIDE]) {
    assert.equal(resolveDisplayPrice(pricing, "basis", "month", true)?.id, "price_basis_m");
    assert.equal(resolveDisplayPrice(pricing, "basis", "year", true)?.id, "price_basis_y");
  }
});

test("earlyBirdPrice liefert den Launch-Preis des Intervalls", () => {
  assert.equal(earlyBirdPrice(BEIDE, "month")?.id, "price_pro_early");
  assert.equal(earlyBirdPrice(BEIDE, "year")?.id, "price_pro_early_y");
  assert.equal(earlyBirdPrice(NUR_MONATLICH, "year"), null);
});

// --- Anzeige und Abrechnung dürfen nie auseinanderlaufen -------------------

/**
 * Der eigentliche Schutz: Was die Tarifauswahl anzeigt, muss exakt der Preis
 * sein, den der Checkout belastet — über alle Kombinationen hinweg, und in
 * beiden Ausbaustufen des Launch-Angebots.
 */
test("die angezeigte Preis-ID ist die, die der Checkout abrechnet", async () => {
  const plans: Plan[] = ["basis", "pro"];
  const intervals: Interval[] = ["month", "year"];

  const szenarien: Array<[string, PlanPricing, string | undefined]> = [
    ["nur monatliches Launch-Angebot", NUR_MONATLICH, undefined],
    ["Launch-Angebot für beide Intervalle", BEIDE, "price_pro_early_y"],
  ];

  for (const [name, pricing, jahresLaunchId] of szenarien) {
    process.env.STRIPE_PRICE_BASIS_MONTHLY = "price_basis_m";
    process.env.STRIPE_PRICE_BASIS_YEARLY = "price_basis_y";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_pro_y";
    process.env.STRIPE_PRICE_PRO_EARLY = "price_pro_early";
    if (jahresLaunchId) {
      process.env.STRIPE_PRICE_PRO_EARLY_YEARLY = jahresLaunchId;
    } else {
      delete process.env.STRIPE_PRICE_PRO_EARLY_YEARLY;
    }

    // Frisch importieren, damit die Umgebung je Szenario neu gelesen wird.
    const { resolvePriceId } = await import(`../lib/stripe?szenario=${encodeURIComponent(name)}`);

    for (const plan of plans) {
      for (const interval of intervals) {
        for (const slotsLeft of [true, false]) {
          const launchVorhanden = Boolean(earlyBirdPrice(pricing, interval));
          const angezeigt = resolveDisplayPrice(pricing, plan, interval, slotsLeft && launchVorhanden);
          const abgerechnet = resolvePriceId(plan, interval, slotsLeft);
          assert.equal(
            angezeigt?.id,
            abgerechnet,
            `${name} — ${plan}/${interval}/Plätze=${slotsLeft}: angezeigt ${angezeigt?.id}, abgerechnet ${abgerechnet}`
          );
        }
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
  assert.equal(intervalSuffix(BEIDE.proYearly, "month"), "/ Jahr");
  assert.equal(intervalSuffix(BEIDE.proMonthly, "year"), "/ Monat");
  assert.equal(intervalSuffix(BEIDE.proEarlyYearly, "month"), "/ Jahr");
});

test("mehrperiodige Preise werden korrekt benannt", () => {
  assert.equal(intervalSuffix(preis("q", 25, "month", 3), "month"), "/ 3 Monate");
});

test("ohne Preis fällt die Beschriftung auf das gewählte Intervall zurück", () => {
  assert.equal(intervalSuffix(null, "year"), "/ Jahr");
  assert.equal(intervalSuffix(null, "month"), "/ Monat");
});
