import { NextRequest, NextResponse } from 'next/server'
import { canManageTeam } from '@/lib/access'
import { getTeamContext, teamErrorResponse, TeamError } from '@/lib/team'

/** PATCH /api/team/departments/:id  Body: { name } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTeamContext()
    if (!canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) throw new TeamError(400, 'Name fehlt')

    const { data, error } = await ctx.db
      .from('departments')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .select('id')
      .maybeSingle()
    if (error) throw new TeamError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'Eine Abteilung mit diesem Namen gibt es schon' : 'Umbenennen fehlgeschlagen')
    if (!data) throw new TeamError(404, 'Abteilung nicht gefunden')
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}

/**
 * DELETE /api/team/departments/:id
 * Nur leere Abteilungen: Rechnungen dürfen nicht stillschweigend die Abteilung
 * wechseln, und die Standardabteilung bleibt.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTeamContext()
    if (!canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')
    const { id } = await params

    const { data: department } = await ctx.db
      .from('departments')
      .select('is_default')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle()
    if (!department) throw new TeamError(404, 'Abteilung nicht gefunden')
    if (department.is_default) throw new TeamError(409, 'Die Standardabteilung kann nicht gelöscht werden')

    const { count } = await ctx.db.from('invoices').select('id', { count: 'exact', head: true }).eq('department_id', id)
    if ((count ?? 0) > 0) throw new TeamError(409, 'Die Abteilung enthält noch Rechnungen oder Entwürfe')

    const { error } = await ctx.db.from('departments').delete().eq('id', id).eq('company_id', ctx.companyId)
    if (error) {
      // Zwischen Zählung und Löschen kann eine Rechnung dazugekommen sein (ON DELETE RESTRICT).
      throw new TeamError(error.code === '23503' ? 409 : 500, error.code === '23503' ? 'Die Abteilung enthält noch Rechnungen oder Entwürfe' : 'Löschen fehlgeschlagen')
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}
