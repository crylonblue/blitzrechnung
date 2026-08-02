import Stripe from 'stripe'

/**
 * Stripe client + price catalog.
 *
 * Price IDs live in the environment, never in code, so the amounts on
 * blitzrechnung.de can change without a deploy and test/live modes stay
 * separate. The plan a price belongs to is derived by reverse-mapping the same
 * env vars, which keeps the webhook honest about what someone actually bought.
 */

export type Plan = 'basis' | 'pro'
export type Interval = 'month' | 'year'

/** How many companies may claim the launch price. */
export const EARLY_BIRD_SLOTS = 100

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-07-29.dahlia',
      appInfo: { name: 'blitzrechnung' },
    })
  }
  return cached
}

function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}

/** The regular list price for a plan/interval, or undefined if not configured. */
export function priceIdFor(plan: Plan, interval: Interval): string | undefined {
  if (plan === 'basis') {
    return interval === 'month'
      ? env('STRIPE_PRICE_BASIS_MONTHLY')
      : env('STRIPE_PRICE_BASIS_YEARLY')
  }
  return interval === 'month'
    ? env('STRIPE_PRICE_PRO_MONTHLY')
    : env('STRIPE_PRICE_PRO_YEARLY')
}

export function earlyBirdPriceId(): string | undefined {
  return env('STRIPE_PRICE_PRO_EARLY')
}

/**
 * Which plan a Stripe price grants. Returns null for a price we don't know,
 * which the webhook treats as "leave the plan alone" rather than guessing.
 */
export function planForPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null
  if (
    priceId === env('STRIPE_PRICE_PRO_MONTHLY') ||
    priceId === env('STRIPE_PRICE_PRO_YEARLY') ||
    priceId === env('STRIPE_PRICE_PRO_EARLY')
  ) {
    return 'pro'
  }
  if (
    priceId === env('STRIPE_PRICE_BASIS_MONTHLY') ||
    priceId === env('STRIPE_PRICE_BASIS_YEARLY')
  ) {
    return 'basis'
  }
  return null
}

export function isEarlyBirdPrice(priceId: string | null | undefined): boolean {
  const early = earlyBirdPriceId()
  return Boolean(priceId && early && priceId === early)
}

/**
 * Base URL for Checkout return links. Falls back to the Vercel-provided host so
 * preview deployments send people back to themselves rather than to production
 * or localhost.
 */
export function appUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export interface PriceInfo {
  id: string
  /** Amount in cents the customer actually pays. No VAT is added or carved
   *  out: the seller is a Kleinunternehmer nach § 19 UStG. */
  unitAmount: number | null
  currency: string
}

export interface PlanPricing {
  basisMonthly: PriceInfo | null
  basisYearly: PriceInfo | null
  proMonthly: PriceInfo | null
  proYearly: PriceInfo | null
  proEarly: PriceInfo | null
}

const EMPTY_PRICING: PlanPricing = {
  basisMonthly: null,
  basisYearly: null,
  proMonthly: null,
  proYearly: null,
  proEarly: null,
}

/**
 * Reads live amounts from Stripe so the settings screen can never advertise a
 * price different from the one checkout charges. Returns nulls when Stripe
 * isn't configured (local dev without keys) so the page still renders.
 */
export async function loadPlanPricing(): Promise<PlanPricing> {
  if (!process.env.STRIPE_SECRET_KEY) return EMPTY_PRICING

  const stripe = getStripe()
  const fetchPrice = async (id: string | undefined): Promise<PriceInfo | null> => {
    if (!id) return null
    try {
      const price = await stripe.prices.retrieve(id)
      return { id: price.id, unitAmount: price.unit_amount, currency: price.currency }
    } catch (err) {
      console.error(`Could not load Stripe price ${id}:`, err)
      return null
    }
  }

  const [basisMonthly, basisYearly, proMonthly, proYearly, proEarly] = await Promise.all([
    fetchPrice(priceIdFor('basis', 'month')),
    fetchPrice(priceIdFor('basis', 'year')),
    fetchPrice(priceIdFor('pro', 'month')),
    fetchPrice(priceIdFor('pro', 'year')),
    fetchPrice(earlyBirdPriceId()),
  ])

  return { basisMonthly, basisYearly, proMonthly, proYearly, proEarly }
}
