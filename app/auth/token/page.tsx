import ConfirmLogin from '@/components/auth/confirm-login'

/**
 * Ziel des Links aus der Mail. Der Token wird erst nach Klick eingelöst, nicht
 * schon beim Aufruf: Viele Mail-Programme und Virenscanner öffnen Links vorab
 * und würden den einmaligen Token sonst verbrauchen, bevor die Person ihn sieht.
 */
export default async function TokenPage({ searchParams }: { searchParams: Promise<{ token_hash?: string }> }) {
  const { token_hash } = await searchParams
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <ConfirmLogin tokenHash={token_hash ?? null} />
    </div>
  )
}
