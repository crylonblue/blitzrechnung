'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoaderCircle, Check } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
// Type-only: keeps the Stripe SDK out of the client bundle.
import type { PlanPricing, PriceInfo, Plan, Interval } from '@/lib/stripe'
import type { BillingState } from '@/lib/billing'

interface BillingSectionProps {
  billing: BillingState
  pricing: PlanPricing
  earlyBirdSlotsLeft: number
}

const PLAN_LABELS: Record<string, string> = { basis: 'Basis', pro: 'Pro' }

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  trialing: 'Testphase',
  past_due: 'Zahlung offen',
  canceled: 'Gekündigt',
  unpaid: 'Nicht bezahlt',
  incomplete: 'Unvollständig',
  incomplete_expired: 'Abgelaufen',
  paused: 'Pausiert',
}

function formatNet(price: PriceInfo | null): string | null {
  if (!price || price.unitAmount === null) return null
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  }).format(price.unitAmount / 100)
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  return format(new Date(value), 'd. MMMM yyyy', { locale: de })
}

export default function BillingSection({ billing, pricing, earlyBirdSlotsLeft }: BillingSectionProps) {
  const [interval, setInterval] = useState<Interval>('month')
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null)
  const [openingPortal, setOpeningPortal] = useState(false)

  const yearlyAvailable = Boolean(pricing.basisYearly || pricing.proYearly)
  const earlyBirdActive = earlyBirdSlotsLeft > 0 && Boolean(pricing.proEarly)

  const startCheckout = async (plan: Plan) => {
    setPendingPlan(plan)
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })
      const data = await response.json()
      if (!response.ok || !data.url) {
        toast.error('Checkout konnte nicht gestartet werden', { description: data.error })
        setPendingPlan(null)
        return
      }
      window.location.href = data.url
    } catch {
      toast.error('Checkout konnte nicht gestartet werden')
      setPendingPlan(null)
    }
  }

  const openPortal = async () => {
    setOpeningPortal(true)
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await response.json()
      if (!response.ok || !data.url) {
        toast.error('Verwaltung konnte nicht geöffnet werden', { description: data.error })
        setOpeningPortal(false)
        return
      }
      window.location.href = data.url
    } catch {
      toast.error('Verwaltung konnte nicht geöffnet werden')
      setOpeningPortal(false)
    }
  }

  // A live subscription: everything else (plan change, payment method,
  // invoices, cancellation) belongs to the Stripe portal, not to us.
  if (billing.plan) {
    const periodEnd = formatDate(billing.currentPeriodEnd)
    return (
      <div>
        <CardHeader className="px-0 pb-4">
          <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
            Tarif
          </CardTitle>
          <CardDescription className="text-sm">
            {PLAN_LABELS[billing.plan]} · {STATUS_LABELS[billing.status] ?? billing.status}
          </CardDescription>
        </CardHeader>
        <div className="space-y-4">
          {periodEnd && (
            <p className="text-sm text-muted-foreground">
              {billing.cancelAtPeriodEnd
                ? `Läuft am ${periodEnd} aus.`
                : `Nächste Abrechnung am ${periodEnd}.`}
            </p>
          )}
          {billing.status === 'past_due' && (
            <div className="message-info">
              Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihre Zahlungsdaten,
              damit Ihr Zugang bestehen bleibt.
            </div>
          )}
          <Button onClick={openPortal} disabled={openingPortal}>
            {openingPortal && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            Tarif & Zahlungsdaten verwalten
          </Button>
        </div>
      </div>
    )
  }

  const proPrice = earlyBirdActive
    ? pricing.proEarly
    : interval === 'year'
      ? pricing.proYearly
      : pricing.proMonthly
  const basisPrice = interval === 'year' ? pricing.basisYearly : pricing.basisMonthly
  const suffix = interval === 'year' ? '/ Jahr' : '/ Monat'

  return (
    <div>
      <CardHeader className="px-0 pb-4">
        <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Tarif
        </CardTitle>
        <CardDescription className="text-sm">
          {billing.inTrial
            ? `Testphase — noch ${billing.trialDaysLeft} ${billing.trialDaysLeft === 1 ? 'Tag' : 'Tage'} mit vollem Pro-Zugriff.`
            : 'Ihre Testphase ist beendet. Wählen Sie einen Tarif, um weiter Rechnungen zu finalisieren.'}
        </CardDescription>
      </CardHeader>
      <div className="space-y-6">
        {yearlyAvailable && (
          <div className="flex gap-2">
            <Button
              variant={interval === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setInterval('month')}
            >
              Monatlich
            </Button>
            <Button
              variant={interval === 'year' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setInterval('year')}
            >
              Jährlich
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <PlanCard
            title="Basis"
            price={formatNet(basisPrice)}
            suffix={suffix}
            features={['Unbegrenzt viele Rechnungen', 'ZUGFeRD 2.3 & XRechnung', '1 Nutzer']}
            loading={pendingPlan === 'basis'}
            disabled={pendingPlan !== null || !basisPrice}
            onSelect={() => startCheckout('basis')}
          />
          <PlanCard
            title="Pro"
            badge={
              earlyBirdActive
                ? `Launch-Angebot · noch ${earlyBirdSlotsLeft} von 100`
                : 'Empfohlen'
            }
            price={formatNet(proPrice)}
            // The launch price is monthly-only, so don't imply a yearly term.
            suffix={earlyBirdActive ? '/ Monat' : suffix}
            features={['Alles aus Basis', 'API-Zugriff für alle Funktionen', 'Bis zu 5 Nutzer']}
            loading={pendingPlan === 'pro'}
            disabled={pendingPlan !== null || !proPrice}
            onSelect={() => startCheckout('pro')}
          />
        </div>

        <p className="text-[13px] text-muted-foreground">
          Kein Ausweis von Umsatzsteuer gemäß § 19 UStG. Jederzeit kündbar.
        </p>
      </div>
    </div>
  )
}

interface PlanCardProps {
  title: string
  badge?: string
  price: string | null
  suffix: string
  features: string[]
  loading: boolean
  disabled: boolean
  onSelect: () => void
}

function PlanCard({ title, badge, price, suffix, features, loading, disabled, onSelect }: PlanCardProps) {
  return (
    <div className="rounded-lg border p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{title}</span>
        {badge && <span className="text-[12px] text-muted-foreground">{badge}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight">{price ?? '—'}</span>
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground flex-1">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Button onClick={onSelect} disabled={disabled} className="w-full">
        {loading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
        {price ? `${title} wählen` : 'Nicht verfügbar'}
      </Button>
    </div>
  )
}
