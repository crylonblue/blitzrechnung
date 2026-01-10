'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_NAME } from '@/lib/config'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setIsLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md space-y-8 rounded-lg border p-8" style={{ background: 'white', borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{APP_NAME}</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Einfache, sichere Rechnungserstellung
          </p>
        </div>

        {error && (
          <div className="message-error">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <Label htmlFor="email">
              E-Mail
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="password">
              Passwort
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1.5"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? 'Wird angemeldet...' : 'Anmelden'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" style={{ borderColor: 'var(--border-default)' }} />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2" style={{ color: 'var(--text-meta)' }}>
              oder
            </span>
          </div>
        </div>

        <Button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          variant="outline"
          className="w-full"
        >
          Mit Google anmelden
        </Button>

        <p className="text-center text-xs" style={{ color: 'var(--text-meta)' }}>
          Noch kein Konto?{' '}
          <a href="/signup" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Registrieren
          </a>
        </p>
      </div>
    </div>
  )
}

