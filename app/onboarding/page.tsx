'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LANDING_PAGE_URL } from '@/lib/config'
import { Spinner } from '@/components/ui/spinner'

export default function OnboardingPage() {
  const [companyName, setCompanyName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  // Check if user is logged in and if they already have a company
  useEffect(() => {
    const checkUserAndCompany = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        // Not logged in, redirect to login
        router.push('/login')
        return
      }

      // Check if user already has a company
      const { data: companyUsers } = await supabase
        .from('company_users')
        .select('company_id')
        .eq('user_id', user.id)
        .limit(1)

      if (companyUsers && companyUsers.length > 0) {
        // Already has a company, redirect to dashboard
        router.push('/')
        return
      }

      // User needs to complete onboarding
      setIsChecking(false)
    }

    checkUserAndCompany()
  }, [supabase, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      setError('Nicht angemeldet')
      setIsLoading(false)
      return
    }

    // Create company using the existing function
    const { data: companyId, error: createError } = await supabase.rpc(
      'create_company_with_owner',
      {
        p_user_id: user.id,
        p_name: companyName.trim(),
        p_address: {
          street: '',
          city: '',
          zip: '',
          country: 'DE',
        },
        p_country: 'DE',
      }
    )

    if (createError) {
      console.error('Error creating company:', createError)
      setError('Fehler beim Erstellen des Unternehmens: ' + createError.message)
      setIsLoading(false)
      return
    }

    if (!companyId) {
      setError('Fehler beim Erstellen des Unternehmens')
      setIsLoading(false)
      return
    }

    // Success! Redirect to dashboard
    router.push('/')
    router.refresh()
  }

  // Show loading while checking auth state
  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--background)' }}>
        <Spinner className="h-8 w-8" />
      </div>
    )
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
            Fast geschafft!
          </h1>
          <p className="text-lg text-white/80">
            Nur noch ein Schritt, dann kannst du deine erste Rechnung erstellen.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium" style={{ background: 'rgba(255, 255, 255, 0.3)' }}>
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-sm text-white/80">Konto erstellt</span>
          </div>
          <div className="w-8 h-px bg-white/30" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-white text-[#038A49]">
              2
            </div>
            <span className="text-sm text-white font-medium">Unternehmen</span>
          </div>
        </div>
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
              Wie heißt dein Unternehmen?
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Dieser Name erscheint auf deinen Rechnungen. Du kannst ihn später in den Einstellungen ändern.
            </p>
          </div>

          {error && (
            <div className="message-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
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
                autoFocus
                className="mt-1.5 h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || !companyName.trim()}
              className="w-full h-11"
            >
              {isLoading ? 'Wird erstellt...' : 'Weiter'}
            </Button>
          </form>

          <p className="text-center text-xs" style={{ color: 'var(--text-meta)' }}>
            Du kannst alle Angaben später in den Einstellungen vervollständigen.
          </p>
        </div>
      </div>
    </div>
  )
}
