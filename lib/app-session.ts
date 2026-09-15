import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Löst angemeldeten Nutzer und Firmenzugehörigkeit genau einmal pro Request auf.
 *
 * Vorher holte sich jede Seite diese Daten selbst — `auth.getUser()`, dann
 * `company_users`, dann `companies` —, obwohl das Layout dieselben drei Aufrufe
 * bereits gemacht hatte. Da `getUser()` das Token beim Auth-Server validiert und
 * damit ein echter Netzwerkaufruf ist, kostete jeder Seitenwechsel drei
 * vermeidbare Roundtrips.
 *
 * `cache()` memoisiert pro Request: Layout und Seite rufen weiterhin beide auf,
 * bezahlen den Aufruf aber nur einmal.
 *
 * Bewusst *nicht* auf `getSession()` umgestellt. Das käme ohne Netzwerk aus,
 * würde aber einem Cookie vertrauen, das der Client selbst schreiben kann — das
 * wäre eine Sicherheitslücke, kein Performance-Gewinn.
 */
export interface AppSession {
  userId: string
  email: string
  userName: string | null
  /** Primäre Firma — dieselbe, die das Layout in der Seitenleiste anzeigt. */
  companyId: string
  companyName: string
  /**
   * Alle Firmen des Nutzers. Die Listenseiten filtern seit jeher über alle
   * Zugehörigkeiten (`.in('company_id', …)`); das bleibt unverändert, damit die
   * Umstellung das Verhalten für Mehrfirmen-Konten nicht stillschweigend ändert.
   */
  companyIds: string[]
  /** Firmen-ID → Name, wie die Listen es zur Anzeige brauchen. */
  companyNames: Record<string, string>
}

export const getAppSession = cache(async (): Promise<AppSession> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Ein Aufruf statt drei: die Fremdschlüssel company_users.company_id →
  // companies und company_users.user_id → user_profiles erlauben es, Firma und
  // Profil direkt einzubetten.
  const { data: memberships } = await supabase
    .from('company_users')
    .select('company_id, companies(name), user_profiles(name, email)')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) {
    redirect('/onboarding')
  }

  const primary = memberships[0] as {
    company_id: string
    companies: { name: string | null } | { name: string | null }[] | null
    user_profiles: { name: string | null; email: string | null } | { name: string | null; email: string | null }[] | null
  }

  // PostgREST liefert eingebettete Relationen je nach Kardinalität als Objekt
  // oder als Array — beides abfangen, statt sich auf eine Variante zu verlassen.
  const company = Array.isArray(primary.companies) ? primary.companies[0] : primary.companies
  const profile = Array.isArray(primary.user_profiles)
    ? primary.user_profiles[0]
    : primary.user_profiles

  const companyNames: Record<string, string> = {}
  for (const membership of memberships) {
    const row = membership as { company_id: string; companies: unknown }
    const c = Array.isArray(row.companies) ? row.companies[0] : row.companies
    const name = (c as { name?: string | null } | null)?.name
    if (name) companyNames[row.company_id] = name
  }

  return {
    userId: user.id,
    email: profile?.email || user.email || '',
    userName: profile?.name ?? null,
    companyId: primary.company_id,
    companyName: company?.name || 'Mein Unternehmen',
    companyIds: memberships.map((m) => (m as { company_id: string }).company_id),
    companyNames,
  }
})
