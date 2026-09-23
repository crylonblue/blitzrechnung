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
}

export const EMPTY_PRICING: PlanPricing = {
  basisMonthly: null,
  basisYearly: null,
  proMonthly: null,
  proYearly: null,
}


/**
 * The price the plan picker should display — the same decision checkout makes
 * when it picks what to charge, resolved against already-loaded amounts.
 *
 * Es gibt nur noch einen Preis je Tarif und Intervall. Bis September 2026 lag
 * darüber ein Launch-Angebot mit 100 Plätzen; die Preise sind inzwischen die
 * regulären, und mit dem Zähler ist auch die Sonderregel entfallen.
 */
export function resolveDisplayPrice(
  pricing: PlanPricing,
  plan: Plan,
  interval: Interval
): PriceInfo | null {
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
