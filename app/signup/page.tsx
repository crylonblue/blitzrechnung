'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md space-y-8 rounded-lg border p-8" style={{ background: 'white', borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>flixy</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Einfache, sichere Rechnungserstellung
          </p>
        </div>

        {error && (
          <div className="message-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <Label htmlFor="companyName">
              Unternehmensname
            </Label>
            <Input
              id="companyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              className="mt-1.5"
            />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-meta)' }}>
              Kann auch Ihr eigener Name sein, falls Sie Einzelunternehmer sind
            </p>
          </div>

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
              minLength={6}
              className="mt-1.5"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? 'Wird registriert...' : 'Registrieren'}
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
          onClick={handleGoogleSignup}
          disabled={isLoading}
          variant="outline"
          className="w-full"
        >
          Mit Google registrieren
        </Button>

        <p className="text-center text-xs" style={{ color: 'var(--text-meta)' }}>
          Bereits ein Konto?{' '}
          <a href="/login" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Anmelden
          </a>
        </p>
      </div>
    </div>
  )
}

