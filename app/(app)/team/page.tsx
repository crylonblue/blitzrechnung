import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAppSession } from '@/lib/app-session'
import { canManageTeam } from '@/lib/access'
import TeamManager, { type TeamMember, type TeamDepartment } from '@/components/team/team-manager'

export default async function TeamPage() {
  const session = await getAppSession()
  const isAdmin = canManageTeam(session.role)
  const managedIds = session.departments.filter((d) => d.managed).map((d) => d.id)

  if (!isAdmin && managedIds.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="message-info">Sie haben keine Berechtigung, das Team zu verwalten.</div>
      </div>
    )
  }

  // Teammitglieder sehen einander per RLS nicht; gelesen wird deshalb mit dem
  // Dienstschlüssel, aber erst nach der Rollenprüfung oben und nur für die
  // eigene Firma. Abteilungs-Manager bekommen nur ihre Abteilungen zu sehen.
  const db = createServiceRoleClient()
  const visibleDepartments = session.departments.filter((d) => isAdmin || d.managed)
  const visibleIds = visibleDepartments.map((d) => d.id)

  const [{ data: memberRows }, { data: deptMemberRows }] = await Promise.all([
    db
      .from('company_users')
      .select('user_id, role, invite_pending, user_profiles(name, email)')
      .eq('company_id', session.companyId),
    db.from('department_members').select('department_id, user_id, role').in('department_id', visibleIds),
  ])

  const departmentsOf = new Map<string, { id: string; role: 'manager' | 'member' }[]>()
  for (const row of deptMemberRows ?? []) {
    const list = departmentsOf.get(row.user_id as string) ?? []
    list.push({ id: row.department_id as string, role: row.role as 'manager' | 'member' })
    departmentsOf.set(row.user_id as string, list)
  }

  const members: TeamMember[] = (memberRows ?? [])
    .map((row) => {
      const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles
      return {
        userId: row.user_id as string,
        role: row.role as TeamMember['role'],
        pending: !!row.invite_pending,
        name: (profile as { name: string | null } | null)?.name ?? null,
        email: (profile as { email: string | null } | null)?.email ?? '',
        departments: departmentsOf.get(row.user_id as string) ?? [],
      }
    })
    // Manager sehen nur Leute aus ihren Abteilungen.
    .filter((m) => isAdmin || m.departments.length > 0)

  const departments: TeamDepartment[] = visibleDepartments.map((d) => ({
    id: d.id,
    name: d.name,
    isDefault: d.isDefault,
  }))

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-12">
        <h1 className="text-headline">Team</h1>
        <p className="mt-2 text-meta">Mitglieder, Rollen und Abteilungen. Rechnungen sind nur für die Abteilung sichtbar, der sie angehören.</p>
      </div>
      <TeamManager
        currentUserId={session.userId}
        isAdmin={isAdmin}
        isOwner={session.role === 'owner'}
        members={members}
        departments={departments}
      />
    </div>
  )
}
