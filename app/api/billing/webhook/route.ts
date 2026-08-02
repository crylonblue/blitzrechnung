import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripe, planForPriceId, isEarlyBirdPrice } from '@/lib/stripe'

/**
 * The only writer of subscription state. The browser is never trusted for this:
 * a user landing on success_url proves nothing, so entitlement changes only
 * when Stripe tells us they happened.
 *
 * Note this path is excluded from the Supabase auth redirect in
 * lib/supabase/middleware.ts — Stripe's POST is unauthenticated and would
 * otherwise be bounced to /login.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Raw body: parsing JSON first would change the bytes and break verification.
  const payload = await request.text()

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    const service = createServiceRoleClient()

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.mode !== 'subscription' || !session.subscription) break
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        await syncSubscription(service, subscription, session.client_reference_id ?? undefined)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(service, event.data.object)
        break
      }
      default:
        break
    }
  } catch (err) {
    // Return 500 so Stripe retries rather than dropping the event.
    console.error(`Error handling Stripe event ${event.type}:`, err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

type Db = SupabaseClient

async function syncSubscription(
  service: Db,
  subscription: Stripe.Subscription,
  fallbackCompanyId?: string
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  let companyId = subscription.metadata?.company_id || fallbackCompanyId || null
  if (!companyId) {
    // Older subscriptions or ones created outside our checkout may lack the
    // metadata; fall back to the customer we recorded when checkout started.
    const { data } = await service
      .from('subscriptions')
      .select('company_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    companyId = data?.company_id ?? null
  }
  if (!companyId) {
    console.error(`No company for Stripe subscription ${subscription.id} (customer ${customerId})`)
    return
  }

  const item = subscription.items.data[0]
  const priceId = item?.price?.id ?? null
  const plan = planForPriceId(priceId)

  // The period moved from the subscription onto its items in recent API
  // versions; read both so this keeps working either way.
  const periodEnd =
    item?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    null

  const row: Record<string, unknown> = {
    company_id: companyId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: priceId,
    // An unrecognised price grants nothing rather than guessing a tier.
    plan: subscription.status === 'canceled' ? 'none' : plan ?? 'none',
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }

  // Only ever set, never cleared: a churned early adopter keeps their claim on
  // the slot instead of handing it back to the next signup.
  if (isEarlyBirdPrice(priceId)) row.early_bird = true

  const { error } = await service.from('subscriptions').upsert(row, { onConflict: 'company_id' })
  if (error) throw new Error(`Failed to persist subscription ${subscription.id}: ${error.message}`)
}
