import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe'
import { meldeFehler } from '@/lib/observability'

/**
 * Plätze: Abgerechnet wird Preis × Zahl der Mitglieder, bei Monats- wie bei
 * Jahrestarif. Die Menge liegt am Abo-Posten in Stripe, die Wahrheit über die
 * Zahl der Plätze ist `company_users`. Ausstehende Einladungen zählen mit: Das
 * Konto besteht ab dem Einladen.
 */
type Db = SupabaseClient

// Zustände, in denen das Abo noch läuft und die Menge geändert werden darf.
const LIVE = new Set<string>(['trialing', 'active', 'past_due'])

export async function countSeats(db: Db, companyId: string): Promise<number> {
  const { count, error } = await db
    .from('company_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('company_id', companyId)
  if (error) throw new Error(`Plätze konnten nicht gezählt werden: ${error.message}`)
  return Math.max(count ?? 0, 1)
}

/**
 * Gleicht die Menge am Stripe-Abo mit der Mitgliederzahl ab. Liest die Menge
 * bewusst aus Stripe statt aus der Datenbank: Die Datenbank folgt erst per
 * Webhook und wäre kurz nach einer Änderung veraltet.
 *
 * Mehr Plätze werden sofort berechnet (anteilig für den Rest der Periode). Bei
 * einem Jahrestarif wäre „zum nächsten Rechnungsdatum“ bis zu ein Jahr später,
 * der Platz würde also ein Jahr lang gratis genutzt. Weniger Plätze schreiben
 * nur ein Guthaben für die nächste Rechnung gut.
 *
 * Gibt die abgeglichene Menge zurück, oder null, wenn es nichts abzugleichen gibt.
 */
export async function syncSeats(db: Db, stripe: Stripe, companyId: string): Promise<number | null> {
  const { data: sub } = await db
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!sub?.stripe_subscription_id) return null

  const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
  const item = subscription.items.data[0]
  if (!LIVE.has(subscription.status) || !item) return null

  const seats = await countSeats(db, companyId)
  const current = item.quantity ?? 1
  if (current === seats) return seats

  await stripe.subscriptions.update(subscription.id, {
    items: [{ id: item.id, quantity: seats }],
    proration_behavior: seats > current ? 'always_invoice' : 'create_prorations',
  })
  return seats
}

/**
 * Wie `syncSeats`, wirft aber nie. Eine Einladung oder Entfernung darf nicht an
 * einem Stripe-Ausfall scheitern; der Fehler wird gemeldet, und der Abgleich beim
 * Öffnen der Einstellungen holt es nach.
 */
export async function syncSeatsSafe(db: Db, companyId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) return
  try {
    await syncSeats(db, getStripe(), companyId)
  } catch (err) {
    meldeFehler(err, { bereich: 'billing.plaetze', companyId })
  }
}
