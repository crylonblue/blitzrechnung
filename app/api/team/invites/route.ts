import { NextRequest, NextResponse } from 'next/server'
import { canManageDepartmentMembers, canManageTeam } from '@/lib/access'
import { createLoginToken, sendInviteMail } from '@/lib/login-token'
import { getTeamContext, teamErrorResponse, TeamError, isEmail } from '@/lib/team'

/**
 * POST /api/team/invites
 * Body: { email, role: 'admin' | 'accountant' | 'member', departmentIds?: string[] }
 *
 * Legt das Konto samt Mitgliedschaft und Abteilungen sofort an und schickt eine
 * Mail mit Anmelde-Link und Code. Bis zur ersten Anmeldung gilt die Person im
 * Team als „eingeladen“ (`company_users.invite_pending`).
 *
 * Owner und Admin laden mit jeder Rolle ein. Ein Abteilungs-Manager lädt nur
 * als `member` ein, und nur in Abteilungen, die er leitet.
 */
export async function POST(request: NextRequest) {
  let createdUserId: string | null = null
  const ctxPromise = getTeamContext()
  try {
    const ctx = await ctxPromise
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = body?.role
    if (body?.departmentIds !== undefined && (!Array.isArray(body.departmentIds) || !body.departmentIds.every((id: unknown) => typeof id === 'string'))) {
      throw new TeamError(400, 'Ungültige Abteilungen')
    }
    // Doppelte Ids würden den Primärschlüssel von department_members verletzen.
    const departmentIds: string[] = [...new Set<string>(body?.departmentIds ?? [])]

    if (!isEmail(email)) throw new TeamError(400, 'Bitte eine gültige E-Mail-Adresse angeben')
    if (!['admin', 'accountant', 'member'].includes(role)) throw new TeamError(400, 'Ungültige Rolle')

    if (!canManageTeam(ctx.scope.role)) {
      const mayInvite =
        role === 'member' &&
        departmentIds.length > 0 &&
        departmentIds.every((id) => canManageDepartmentMembers(ctx.scope, id))
      if (!mayInvite) throw new TeamError(403, 'Keine Berechtigung, mit dieser Rolle einzuladen')
    }

    if (departmentIds.length > 0) {
      const { data: valid } = await ctx.db
        .from('departments')
        .select('id')
        .eq('company_id', ctx.companyId)
        .in('id', departmentIds)
      if ((valid?.length ?? 0) !== departmentIds.length) {
        throw new TeamError(400, 'Unbekannte Abteilung')
      }
    }

    const { data: profile } = await ctx.db.from('user_profiles').select('id').eq('email', email).maybeSingle()

    let userId: string
    if (profile) {
      // Ein bestehendes Konto in einer anderen Organisation würde hier ungefragt
      // dazugebucht — und die App zeigt je Nutzer die erste Zugehörigkeit. Das
      // ist erst mit einem Org-Wechsler vertretbar.
      const { data: memberships } = await ctx.db.from('company_users').select('company_id').eq('user_id', profile.id)
      if (memberships?.some((m) => m.company_id === ctx.companyId)) {
        throw new TeamError(409, 'Diese Person gehört bereits zum Team')
      }
      if (memberships && memberships.length > 0) {
        throw new TeamError(409, 'Diese Adresse nutzt bereits ein Konto in einer anderen Organisation')
      }
      userId = profile.id
    } else {
      const { data: created, error } = await ctx.db.auth.admin.createUser({ email, email_confirm: true })
      if (error || !created.user) throw new TeamError(500, 'Konto konnte nicht angelegt werden')
      userId = created.user.id
      createdUserId = userId
    }

    const { error: memberError } = await ctx.db
      .from('company_users')
      .insert({ user_id: userId, company_id: ctx.companyId, role, invite_pending: createdUserId !== null })
    if (memberError) throw new TeamError(500, 'Mitgliedschaft konnte nicht angelegt werden')

    if (departmentIds.length > 0) {
      const { error: deptError } = await ctx.db
        .from('department_members')
        .insert(departmentIds.map((department_id) => ({ department_id, user_id: userId, role: 'member' })))
      if (deptError) {
        await ctx.db.from('company_users').delete().eq('user_id', userId).eq('company_id', ctx.companyId)
        throw new TeamError(500, 'Abteilungen konnten nicht zugeordnet werden')
      }
    }
    createdUserId = null // ab hier bleibt das Konto bestehen

    // Scheitert die Mail, bleibt die Person eingeladen und die Oberfläche bietet
    // „Erneut senden“ an. Der Link wird bewusst nie an den Einladenden zurückgegeben:
    // er meldet als die eingeladene Person an.
    let emailSent = true
    try {
      const [{ data: company }, { data: inviter }] = await Promise.all([
        ctx.db.from('companies').select('name').eq('id', ctx.companyId).single(),
        ctx.db.from('user_profiles').select('name').eq('id', ctx.userId).single(),
      ])
      const token = await createLoginToken(ctx.db, email)
      await sendInviteMail(email, token, {
        companyName: company?.name ?? 'einem Unternehmen',
        inviterName: inviter?.name ?? null,
      })
    } catch (err) {
      emailSent = false
      console.error('invite email failed', err)
    }

    return NextResponse.json({ userId, emailSent }, { status: 201 })
  } catch (err) {
    if (createdUserId) {
      // Halbfertige Einladung zurückrollen, sonst bliebe ein Konto ohne Zweck.
      const ctx = await ctxPromise.catch(() => null)
      await ctx?.db.auth.admin.deleteUser(createdUserId)
    }
    return teamErrorResponse(err)
  }
}
