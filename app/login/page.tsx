'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LANDING_PAGE_URL } from '@/lib/config'

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
    <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12" style={{ background: 'linear-gradient(135deg, #038A49 0%, #026b39 100%)' }}>
        <div>
          <Link href={LANDING_PAGE_URL} className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.49999 12.25C3.33441 12.2506 3.17207 12.2041 3.03183 12.1161C2.89158 12.0281 2.7792 11.9021 2.70772 11.7527C2.63625 11.6033 2.60862 11.4368 2.62806 11.2723C2.64749 11.1079 2.71318 10.9523 2.81749 10.8238L11.48 1.89875C11.545 1.82375 11.6335 1.77306 11.7311 1.75502C11.8287 1.73697 11.9295 1.75264 12.017 1.79944C12.1045 1.84625 12.1735 1.92141 12.2127 2.0126C12.2518 2.10378 12.2588 2.20557 12.2325 2.30125L10.5525 7.56875C10.503 7.70134 10.4863 7.84396 10.504 7.98438C10.5217 8.12481 10.5732 8.25885 10.6541 8.375C10.7349 8.49115 10.8428 8.58595 10.9684 8.65127C11.0939 8.71658 11.2335 8.75046 11.375 8.75H17.5C17.6656 8.74944 17.8279 8.79587 17.9682 8.8839C18.1084 8.97193 18.2208 9.09794 18.2923 9.2473C18.3637 9.39666 18.3914 9.56324 18.3719 9.72768C18.3525 9.89211 18.2868 10.0477 18.1825 10.1763L9.51999 19.1013C9.45501 19.1763 9.36647 19.2269 9.26888 19.245C9.1713 19.263 9.07048 19.2474 8.98298 19.2006C8.89547 19.1538 8.82648 19.0786 8.78733 18.9874C8.74817 18.8962 8.74118 18.7944 8.76749 18.6988L10.4475 13.4313C10.497 13.2987 10.5137 13.156 10.496 13.0156C10.4783 12.8752 10.4268 12.7412 10.3459 12.625C10.265 12.5089 10.1572 12.4141 10.0316 12.3487C9.90606 12.2834 9.76653 12.2495 9.62499 12.25H3.49999Z" fill="white"/>
            </svg>
            <span className="text-xl font-semibold text-white">blitzrechnung</span>
          </Link>
        </div>
        
        <div className="space-y-6">
          <h1 className="text-4xl font-semibold text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
            Willkommen zurück.
          </h1>
          <p className="text-lg text-white/80">
            Melde dich an und erstelle in Sekunden professionelle E-Rechnungen.
          </p>
        </div>
        
        <p className="text-sm text-white/60">
          Noch kein Konto?{' '}
          <a href="/signup" className="text-white underline hover:no-underline">
            Jetzt kostenlos registrieren
          </a>
        </p>
      </div>
      
      {/* Right side - Form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden mb-8">
            <Link href={LANDING_PAGE_URL}>
              <Image
                src="/logo_black.svg"
                alt="blitzrechnung"
                width={105}
                height={21}
                priority
              />
            </Link>
          </div>
          
          <div>
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Anmelden
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Gib deine Zugangsdaten ein, um fortzufahren
            </p>
          </div>

          {error && (
            <div className="message-error">
              {error}
            </div>
          )}

          <Button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            variant="outline"
            className="w-full h-11 gap-3"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Mit Google anmelden
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" style={{ borderColor: 'var(--border-default)' }} />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4" style={{ color: 'var(--text-meta)', background: 'var(--background)' }}>
                oder mit E-Mail
              </span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">
                E-Mail
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@firma.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1.5 h-11"
              />
            </div>

            <div>
              <Label htmlFor="password">
                Passwort
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Dein Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1.5 h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11"
            >
              {isLoading ? 'Wird angemeldet...' : 'Anmelden'}
            </Button>
          </form>

          <p className="text-center text-sm" style={{ color: 'var(--text-meta)' }}>
            Noch kein Konto?{' '}
            <a href="/signup" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Kostenlos registrieren
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
