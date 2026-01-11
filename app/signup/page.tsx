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

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    // Create user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: companyName.trim(),
        },
      },
    })

    if (authError) {
      setError(authError.message)
      setIsLoading(false)
      return
    }

    if (!authData.user) {
      setError('Registrierung fehlgeschlagen')
      setIsLoading(false)
      return
    }

    // Try using function first, fallback to direct insert
    let companyId: string | null = null
    let company: any = null

    // Try function first (if it exists)
    // Pass user_id explicitly since auth.uid() is NULL before email confirmation
    const { data: functionCompanyId, error: functionError } = await supabase.rpc(
      'create_company_with_owner',
      {
        p_user_id: authData.user.id,
        p_name: companyName,
        p_address: {
          street: '',
          city: '',
          zip: '',
          country: 'DE',
        },
        p_country: 'DE',
      }
    )

    if (!functionError && functionCompanyId) {
      companyId = functionCompanyId
      // Get the created company
      const { data: fetchedCompany, error: fetchError } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single()

      if (!fetchError && fetchedCompany) {
        company = fetchedCompany
      }
    }

    // Fallback to direct insert if function doesn't work
    if (!company) {
      // Generate UUID client-side to avoid needing .select()
      // This bypasses the RLS SELECT policy issue during signup
      const generatedCompanyId = crypto.randomUUID()

      // Insert company WITHOUT .select() - only INSERT policy is checked
      const { error: companyError } = await supabase
        .from('companies')
        .insert({
          id: generatedCompanyId,
          name: companyName,
          address: {
            street: '',
            city: '',
            zip: '',
            country: 'DE',
          },
          country: 'DE',
        })

      if (companyError) {
        setError('Fehler beim Erstellen des Unternehmens: ' + companyError.message)
        setIsLoading(false)
        return
      }

      // Link user to company as owner
      const { error: linkError } = await supabase.from('company_users').insert({
        user_id: authData.user.id,
        company_id: generatedCompanyId,
        role: 'owner',
      })

      if (linkError) {
        setError('Fehler beim Verknüpfen des Unternehmens: ' + linkError.message)
        setIsLoading(false)
        return
      }

      companyId = generatedCompanyId
      company = { id: generatedCompanyId, name: companyName }
    }

    router.push('/')
    router.refresh()
  }

  const handleGoogleSignup = async () => {
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

  const features = [
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
      title: 'Blitzschnell erstellt',
      description: 'Rechnungen in unter 60 Sekunden'
    },
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
      title: 'XRechnung & ZUGFeRD',
      description: 'E-Rechnungen gemäß EU-Standard'
    },
    {
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      ),
      title: 'Bereit für 2026',
      description: 'E-Rechnungspflicht ab Januar 2026'
    },
  ]

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
        
        <div className="space-y-8">
          <h1 className="text-4xl font-semibold text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
            Professionelle Rechnungen,<br />blitzschnell erstellt.
          </h1>
          
          <div className="space-y-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start gap-4">
                <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.15)' }}>
                  <span className="text-white">{feature.icon}</span>
                </div>
                <div>
                  <h3 className="font-medium text-white">{feature.title}</h3>
                  <p className="text-sm text-white/70">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <p className="text-sm text-white/60">
          Kostenlos starten · Keine Kreditkarte erforderlich
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
              Konto erstellen
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Starte jetzt kostenlos mit deiner ersten Rechnung
            </p>
          </div>

          {error && (
            <div className="message-error">
              {error}
            </div>
          )}

          <Button
            onClick={handleGoogleSignup}
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
            Mit Google registrieren
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" style={{ borderColor: 'var(--border-default)' }} />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4" style={{ color: 'var(--text-meta)', background: 'var(--background)' }}>
                oder mit E-Mail
              </span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <Label htmlFor="companyName">
                Unternehmensname
              </Label>
              <Input
                id="companyName"
                type="text"
                placeholder="z.B. Max Mustermann oder Muster GmbH"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="mt-1.5 h-11"
              />
            </div>

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
                placeholder="Mindestens 6 Zeichen"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1.5 h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11"
            >
              {isLoading ? 'Wird registriert...' : 'Kostenlos registrieren'}
            </Button>
          </form>

          <p className="text-center text-sm" style={{ color: 'var(--text-meta)' }}>
            Bereits ein Konto?{' '}
            <a href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Anmelden
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

