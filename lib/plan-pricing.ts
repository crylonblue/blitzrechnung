/**
 * Tarife, Preisdarstellung und die Regel, welcher Preis wann gilt.
 *
 * Bewusst frei von jedem Stripe-SDK-Import: Diese Datei wird auch von der
 * Tarifauswahl im Browser benutzt, und `lib/stripe.ts` zieht das Node-SDK
 * (~267 KB) nach. Alles, was Server *und* Client brauchen, gehört hierher;
 * alles, was einen Stripe-Client braucht, bleibt in `lib/stripe.ts`.
 */

export type Plan = 'basis' | 'pro'
export type Interval = 'month' | 'year'

/** How many companies may claim the launch price. */
export const EARLY_BIRD_SLOTS = 100

export interface PriceInfo {
  id: string
  /** Amount in cents the customer actually pays. No VAT is added or carved
   *  out: the seller is a Kleinunternehmer nach § 19 UStG. */
  unitAmount: number | null
  currency: string
  /**
   * The interval Stripe actually bills on, not the one the UI happens to have
   * selected. Kept so the plan picker labels a price by what it really is: a
   * monthly price shown under a "Jährlich" toggle must not read "/ Jahr".
   */
  interval: Interval | null
  /** How many intervals per charge — 3x month is quarterly, not monthly. */
  intervalCount: number
}

export interface PlanPricing {
  basisMonthly: PriceInfo | null
  basisYearly: PriceInfo | null
  proMonthly: PriceInfo | null
  proYearly: PriceInfo | null
  proEarly: PriceInfo | null
}

export const EMPTY_PRICING: PlanPricing = {
  basisMonthly: null,
  basisYearly: null,
  proMonthly: null,
  proYearly: null,
  proEarly: null,
}

/**
 * Whether the launch price applies to a given plan and interval.
 *
 * The launch offer is a monthly price (5,00 €) and there is no yearly
 * counterpart, so it can only ever replace Pro monthly.
 *
 * This rule used to live in two places — the checkout route decided what to
 * charge, the plan picker decided what to show — and they disagreed: the picker
 * kept showing the launch price under the "Jährlich" toggle while checkout
 * billed the regular yearly price. A customer read 5,00 €/Monat, expected
 * 60,00 € for the year and was charged 96,00 €. Both sides now call this, so
 * they cannot drift apart again.
 */
export function earlyBirdApplies(
  plan: Plan,
  interval: Interval,
  earlyBirdAvailable: boolean
): boolean {
  return plan === 'pro' && interval === 'month' && earlyBirdAvailable
}

/**
 * The price the plan picker should display — the same decision checkout makes
 * when it picks what to charge, resolved against already-loaded amounts.
 */
export function resolveDisplayPrice(
  pricing: PlanPricing,
  plan: Plan,
  interval: Interval,
  earlyBirdAvailable: boolean
): PriceInfo | null {
  if (earlyBirdApplies(plan, interval, earlyBirdAvailable) && pricing.proEarly) {
    return pricing.proEarly
  }
  if (plan === 'basis') {
    return interval === 'year' ? pricing.basisYearly : pricing.basisMonthly
  }
  return interval === 'year' ? pricing.proYearly : pricing.proMonthly
}

/**
 * How a price is labelled, derived from what Stripe actually bills rather than
 * from the selected toggle.
 */
export function intervalSuffix(price: PriceInfo | null, fallback: Interval): string {
  const interval = price?.interval ?? fallback
  const count = price?.intervalCount ?? 1
  const unit = interval === 'year' ? 'Jahr' : 'Monat'
  return count > 1 ? `/ ${count} ${unit}e` : `/ ${unit}`
}
