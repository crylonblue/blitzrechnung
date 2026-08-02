import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripe, priceIdFor, earlyBirdPriceId, appUrl, type Plan, type Interval } from '@/lib/stripe'
import { earlyBirdSlotsLeft } from '@/lib/billing'

// Tags these sessions in the Dashboard so checkout flows stay comparable.
const INTEGRATION_ID = 'blitzrechnung-subscription-kvxmrtwd'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const plan: Plan = body.plan === 'basis' ? 'basis' : 'pro'
    const interval: Interval = body.interval === 'year' ? 'year' : 'month'

    // Billing is an owner-only action.
    const { data: membership } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    if (!membership) {
      return NextResponse.json({ error: 'Nur Inhaber können den Tarif ändern' }, { status: 403 })
    }
    const companyId = membership.company_id as string

    const service = createServiceRoleClient()

    // The launch offer replaces the Pro monthly price while slots remain. Using
    // a separate price rather than a coupon means the subscription carries the
    // 5,00 € forever on its own, with no discount line on the invoice.
    let priceId = priceIdFor(plan, interval)
    if (plan === 'pro' && interval === 'month') {
      const early = earlyBirdPriceId()
      if (early && (await earlyBirdSlotsLeft(service)) > 0) priceId = early
    }
    if (!priceId) {
      return NextResponse.json({ error: 'Dieser Tarif ist derzeit nicht verfügbar' }, { status: 400 })
    }

    const stripe = getStripe()

    const { data: existing } = await service
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle()

    let customerId: string | null = existing?.stripe_customer_id ?? null
    if (!customerId) {
      const { data: company } = await service
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .single()
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: company?.name ?? undefined,
        metadata: { company_id: companyId },
      })
      customerId = customer.id
      await service.from('subscriptions').upsert(
        {
          company_id: companyId,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id' }
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Kleinunternehmer nach § 19 UStG: no VAT is charged or shown, so Stripe
      // Tax stays off. Turning it on would need a tax registration, and any
      // VAT shown on an invoice would become genuinely owed under § 14c UStG.
      automatic_tax: { enabled: false },
      // We always attach a Customer, so Checkout would otherwise reuse a stale
      // saved address. Collected for the invoice record, not for tax.
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      locale: 'de',
      integration_identifier: INTEGRATION_ID,
      client_reference_id: companyId,
      subscription_data: { metadata: { company_id: companyId } },
      success_url: `${appUrl()}/settings?billing=success`,
      cancel_url: `${appUrl()}/settings?billing=cancelled`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Error creating checkout session:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
