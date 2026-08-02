import type { SupabaseClient } from '@supabase/supabase-js'
import { EARLY_BIRD_SLOTS, type Plan } from './stripe'

/**
 * Entitlement logic, shared by the session API, the public API-key API and the
 * UI. Two things can grant access: an app-managed 14-day trial (no card, full
 * Pro) and a live Stripe subscription.
 *
 * Loosely typed client for the same reason as invoice-service: the project's
 * Supabase clients aren't generic over the Database type.
 */
type Db = SupabaseClient

export const TRIAL_DAYS = 14

/**
 * Subscription statuses that still grant access. `past_due` is deliberately
 * included: Stripe retries a failed charge for roughly two weeks, and cutting
 * someone off mid-invoice over a temporarily declined card is worse for us than
 * a few days of grace. They lose access once Stripe gives up and moves the
 * subscription to `unpaid` or `canceled`.
 */
const ENTITLING_STATUSES = new Set(['trialing', 'active', 'past_due'])

export interface BillingState {
  plan: Plan | null
  status: string
  /** May finalize invoices — i.e. has any live plan or an unexpired trial. */
  entitled: boolean
  /** May use Pro-only features (API access). Trials get full Pro. */
  isPro: boolean
  inTrial: boolean
  trialEndsAt: string | null
  trialDaysLeft: number
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  stripeCustomerId: string | null
}

export async function getBillingState(supabase: Db, companyId: string): Promise<BillingState> {
  const [{ data: company, error: companyError }, { data: sub }] = await Promise.all([
    supabase.from('companies').select('trial_ends_at').eq('id', companyId).single(),
    supabase.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle(),
  ])

  // Fail open. If we can't read billing state at all — migration not applied
  // yet, database hiccup — locking every customer out of finalizing their
  // invoices is far worse than briefly giving away access we should charge for.
  if (companyError) {
    console.error(`Could not resolve billing state for company ${companyId}:`, companyError)
    return {
      plan: null,
      status: 'unknown',
      entitled: true,
      isPro: true,
      inTrial: false,
      trialEndsAt: null,
      trialDaysLeft: 0,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      stripeCustomerId: null,
    }
  }

  const trialEndsAt: string | null = company?.trial_ends_at ?? null
  const now = Date.now()
  const trialMs = trialEndsAt ? new Date(trialEndsAt).getTime() - now : 0
  const inTrial = trialMs > 0
  const trialDaysLeft = inTrial ? Math.ceil(trialMs / 86_400_000) : 0

  const status: string = sub?.status ?? 'none'
  const subscribed = ENTITLING_STATUSES.has(status)
  const plan = (sub?.plan && sub.plan !== 'none' ? sub.plan : null) as Plan | null

  return {
    plan,
    status,
    entitled: subscribed || inTrial,
    isPro: (subscribed && plan === 'pro') || inTrial,
    inTrial,
    trialEndsAt,
    trialDaysLeft,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    currentPeriodEnd: sub?.current_period_end ?? null,
    stripeCustomerId: sub?.stripe_customer_id ?? null,
  }
}

/**
 * How many of the 100 launch slots are gone. Needs a service-role client: RLS
 * only lets a company see its own subscription row.
 */
export async function earlyBirdSlotsLeft(serviceRole: Db): Promise<number> {
  const { count } = await serviceRole
    .from('subscriptions')
    .select('company_id', { count: 'exact', head: true })
    .eq('early_bird', true)
  return Math.max(0, EARLY_BIRD_SLOTS - (count ?? 0))
}

export const TRIAL_EXPIRED_MESSAGE = 'Testphase abgelaufen'
export const TRIAL_EXPIRED_DETAILS =
  'Ihre 14-tägige Testphase ist beendet. Wählen Sie einen Tarif, um weiter Rechnungen zu finalisieren. Ihre Entwürfe und bestehenden Rechnungen bleiben erhalten.'
