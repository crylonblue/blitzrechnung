import Link from 'next/link'

interface TrialConversionBannerProps {
  /** A live paid plan, or null while trialing / after expiry. */
  plan: 'basis' | 'pro' | null
  inTrial: boolean
  entitled: boolean
  trialDaysLeft: number
}

/**
 * Dashboard conversion prompt. Visible for the whole trial, not just the last
 * few days, because this is the one screen where a nudge belongs — the thin
 * banner in the app shell stays quiet until the trial is nearly over and hides
 * itself here so the two never stack.
 */
export default function TrialConversionBanner({
  plan,
  inTrial,
  entitled,
  trialDaysLeft,
}: TrialConversionBannerProps) {
  // Paying customers never see this.
  if (plan) return null

  const expired = !entitled
  if (!expired && !inTrial) return null

  const accent = expired ? 'var(--status-warning)' : 'var(--accent)'
  const tint = expired ? '139, 122, 91' : '91, 124, 153'

  return (
    <div
      className="mb-8 rounded-lg border px-5 py-4"
      style={{
        background: `linear-gradient(135deg, rgba(${tint}, 0.08) 0%, rgba(${tint}, 0.04) 100%)`,
        borderColor: `rgba(${tint}, 0.25)`,
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: `rgba(${tint}, 0.15)` }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: accent }}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            {expired
              ? 'Testphase beendet'
              : `Noch ${trialDaysLeft} ${trialDaysLeft === 1 ? 'Tag' : 'Tage'} im Test`}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {expired
              ? 'Ihre Entwürfe und bestehenden Rechnungen bleiben erhalten. Zum Finalisieren neuer Rechnungen wird ein Tarif benötigt.'
              : 'Sie haben vollen Pro-Zugriff. Wählen Sie einen Tarif, um danach nahtlos weiterzuarbeiten.'}
          </p>
          <Link
            href="/settings?tab=tarif"
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{ background: 'var(--text-primary)', color: 'white', textDecoration: 'none' }}
          >
            Tarif wählen
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  )
}
