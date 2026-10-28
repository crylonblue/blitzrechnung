import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canManageTeam, isCompanyRole, writableDepartmentIds, type CompanyRole, type InvoiceScope } from '@/lib/access'

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
export interface SessionDepartment {
  id: string
  name: string
  isDefault: boolean
  /** Der Nutzer darf hier Rechnungen anlegen und ändern. */
  writable: boolean
  /** Der Nutzer leitet die Abteilung (oder ist Admin/Owner). */
  managed: boolean
}

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
  /** Rolle des Nutzers in der primären Firma. */
  role: CompanyRole
  /**
   * Abteilungen der primären Firma. Jedes Mitglied sieht alle Namen; ob es dort
   * auch Rechnungen sehen darf, steht in `writable` und ergibt sich sonst aus
   * der RLS. Die Oberfläche blendet damit nur aus, durchgesetzt wird in der Datenbank.
   */
  departments: SessionDepartment[]
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
    .select('company_id, role, companies(name), user_profiles(name, email)')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) {
    redirect('/onboarding')
  }

  const primary = memberships[0] as {
    company_id: string
    role: string
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

  const role: CompanyRole = isCompanyRole(primary.role) ? primary.role : 'member'

  const [{ data: departmentRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, is_default')
      .eq('company_id', primary.company_id)
      .order('name'),
    supabase
      .from('department_members')
      .select('department_id, role')
      .eq('user_id', user.id),
  ])

  // Nur Abteilungen dieser Firma zählen; die Mitgliedszeilen sind nutzerweit.
  const scope: InvoiceScope = { role, departmentIds: [], managedDepartmentIds: [] }
  const memberOf = new Map((memberRows ?? []).map((r) => [r.department_id as string, r.role as string]))
  for (const d of departmentRows ?? []) {
    const memberRole = memberOf.get(d.id as string)
    if (!memberRole) continue
    scope.departmentIds.push(d.id as string)
    if (memberRole === 'manager') scope.managedDepartmentIds.push(d.id as string)
  }
  const writable = writableDepartmentIds(scope)
  const admin = canManageTeam(role)
  const departments: SessionDepartment[] = (departmentRows ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    isDefault: !!d.is_default,
    writable: writable === null || writable.includes(d.id as string),
    managed: admin || scope.managedDepartmentIds.includes(d.id as string),
  }))

  return {
    userId: user.id,
    email: profile?.email || user.email || '',
    userName: profile?.name ?? null,
    companyId: primary.company_id,
    companyName: company?.name || 'Mein Unternehmen',
    companyIds: memberships.map((m) => (m as { company_id: string }).company_id),
    companyNames,
    role,
    departments,
  }
})
