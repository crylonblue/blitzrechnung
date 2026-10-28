import { NextRequest, NextResponse } from 'next/server'
import { canManageTeam, isOwner } from '@/lib/access'
import { syncSeatsSafe } from '@/lib/seats'
import { getTeamContext, teamErrorResponse, TeamError } from '@/lib/team'

async function loadTarget(ctx: Awaited<ReturnType<typeof getTeamContext>>, userId: string) {
  const { data } = await ctx.db
    .from('company_users')
    .select('role, invite_pending')
    .eq('company_id', ctx.companyId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) throw new TeamError(404, 'Mitglied nicht gefunden')
  return data as { role: string; invite_pending: boolean }
}

async function otherOwnersExist(ctx: Awaited<ReturnType<typeof getTeamContext>>, userId: string) {
  const { count } = await ctx.db
    .from('company_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('company_id', ctx.companyId)
    .eq('role', 'owner')
    .neq('user_id', userId)
  return (count ?? 0) > 0
}

/**
 * PATCH /api/team/members/:userId  Body: { role }
 * Owner und Admin ändern Rollen. Eigentümer ernennen und absetzen darf nur ein
 * Eigentümer, und es bleibt immer mindestens einer.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await getTeamContext()
    if (!canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')
    const { userId } = await params
    const body = await request.json().catch(() => null)
    const role = body?.role
    if (!['owner', 'admin', 'accountant', 'member'].includes(role)) throw new TeamError(400, 'Ungültige Rolle')

    const target = await loadTarget(ctx, userId)
    if ((target.role === 'owner' || role === 'owner') && !isOwner(ctx.scope.role)) {
      throw new TeamError(403, 'Nur ein Eigentümer kann Eigentümer ernennen oder ändern')
    }
    if (target.role === 'owner' && role !== 'owner' && !(await otherOwnersExist(ctx, userId))) {
      throw new TeamError(409, 'Es muss mindestens ein Eigentümer bleiben')
    }

    const { error } = await ctx.db
      .from('company_users')
      .update({ role })
      .eq('company_id', ctx.companyId)
      .eq('user_id', userId)
    if (error) throw new TeamError(500, 'Rolle konnte nicht geändert werden')
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}

/** DELETE /api/team/members/:userId — aus der Firma entfernen (oder selbst austreten). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await getTeamContext()
    const { userId } = await params
    const self = userId === ctx.userId
    if (!self && !canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')

    const target = await loadTarget(ctx, userId)
    if (target.role === 'owner') {
      if (!isOwner(ctx.scope.role)) throw new TeamError(403, 'Nur ein Eigentümer kann Eigentümer entfernen')
      if (!(await otherOwnersExist(ctx, userId))) throw new TeamError(409, 'Es muss mindestens ein Eigentümer bleiben')
    }

    const { data: departments } = await ctx.db.from('departments').select('id').eq('company_id', ctx.companyId)
    const departmentIds = (departments ?? []).map((d) => d.id as string)
    if (departmentIds.length > 0) {
      const { error } = await ctx.db.from('department_members').delete().eq('user_id', userId).in('department_id', departmentIds)
      if (error) throw new TeamError(500, 'Entfernen fehlgeschlagen')
    }
    // API-Schlüssel gehören dem Nutzer; ohne ihn sind sie nur ein offenes Tor.
    const { error: keyError } = await ctx.db.from('api_keys').delete().eq('user_id', userId).eq('company_id', ctx.companyId)
    if (keyError) throw new TeamError(500, 'Entfernen fehlgeschlagen')
    const { error: memberError } = await ctx.db.from('company_users').delete().eq('user_id', userId).eq('company_id', ctx.companyId)
    if (memberError) throw new TeamError(500, 'Entfernen fehlgeschlagen')

    await syncSeatsSafe(ctx.db, ctx.companyId)

    // Eine nie angemeldete, nur für diese Einladung angelegte Person lässt kein
    // Konto ohne Zweck zurück. `invite_pending` allein genügt nicht: Wer sich
    // per Google oder Passwort-Reset angemeldet hat, ist ein echter Nutzer,
    // auch wenn das Flag noch steht. Gelöscht wird nur ohne jede Anmeldung.
    if (target.invite_pending) {
      const { data: auth } = await ctx.db.auth.admin.getUserById(userId)
      if (auth?.user && !auth.user.last_sign_in_at) {
        await ctx.db.auth.admin.deleteUser(userId)
      }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}
