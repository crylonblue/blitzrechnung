import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripe, appUrl } from '@/lib/stripe'

/**
 * Hands off to the Stripe Customer Portal, which is the entire subscription
 * management surface: plan changes, payment method, invoices and cancellation
 * ("jederzeit kündbar") all live there rather than in our settings screens.
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    const service = createServiceRoleClient()
    const { data: sub } = await service
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', membership.company_id)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: 'Kein aktives Abonnement vorhanden' }, { status: 404 })
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${appUrl()}/settings`,
      locale: 'de',
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Error creating portal session:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
