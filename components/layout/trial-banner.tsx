'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface TrialBannerProps {
  inTrial: boolean
  entitled: boolean
  trialDaysLeft: number
}

/**
 * Deliberately quiet: nothing appears while there's still a week of trial left,
 * and nothing at all once someone is paying. A calm product shouldn't nag.
 *
 * Hidden on the dashboard, which carries its own fuller conversion banner —
 * two prompts stacked on one screen would be exactly the nagging we're avoiding.
 */
export default function TrialBanner({ inTrial, entitled, trialDaysLeft }: TrialBannerProps) {
  const onDashboard = usePathname() === '/'
  const expired = !entitled
  const endingSoon = inTrial && trialDaysLeft <= 7
  if (onDashboard || (!expired && !endingSoon)) return null

  return (
    <div
      className="flex items-center justify-between gap-4 border-b px-6 py-3 text-sm"
      style={{ borderColor: 'var(--border-default)', background: 'var(--surface-subtle, transparent)' }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>
        {expired
          ? 'Ihre Testphase ist beendet. Entwürfe bleiben erhalten — zum Finalisieren wird ein Tarif benötigt.'
          : `Noch ${trialDaysLeft} ${trialDaysLeft === 1 ? 'Tag' : 'Tage'} im Test.`}
      </span>
      <Link href="/settings?tab=tarif" className="font-medium underline underline-offset-4 shrink-0">
        Tarif wählen
      </Link>
    </div>
  )
}
