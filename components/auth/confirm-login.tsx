'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'

export default function ConfirmLogin({ tokenHash }: { tokenHash: string | null }) {
  const router = useRouter()
  const supabase = createClient()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!tokenHash) {
    return (
      <div className="card p-8">
        <div className="message-error">Dieser Link ist unvollständig.</div>
        <Link href="/login" className="mt-4 inline-block text-sm underline">Zur Anmeldung</Link>
      </div>
    )
  }

  const signIn = async () => {
    setIsLoading(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    if (error) {
      setError('Der Link ist abgelaufen oder wurde schon benutzt. Fordern Sie auf der Anmeldeseite einen neuen an.')
      setIsLoading(false)
      return
    }
    // Nimmt „eingeladen“ vom Konto; ein Fehlschlag hält die Anmeldung nicht auf.
    await fetch('/api/team/joined', { method: 'POST' }).catch(() => undefined)
    router.push('/')
    router.refresh()
  }

  return (
    <div className="card p-8">
      <h1 className="text-headline">Anmelden</h1>
      <p className="mt-3 text-secondary">Mit einem Klick bei Blitzrechnung anmelden.</p>
      {error && <div className="message-error mt-4">{error}</div>}
      <Button className="mt-6" onClick={signIn} disabled={isLoading}>
        {isLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
        Jetzt anmelden
      </Button>
      {error && <Link href="/login" className="mt-4 block text-sm underline">Zur Anmeldung</Link>}
    </div>
  )
}
