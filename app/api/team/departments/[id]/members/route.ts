import { NextRequest, NextResponse } from 'next/server'
import { canManageDepartmentMembers } from '@/lib/access'
import { getTeamContext, teamErrorResponse, TeamError } from '@/lib/team'

async function assertManager(ctx: Awaited<ReturnType<typeof getTeamContext>>, departmentId: string) {
  const { data } = await ctx.db
    .from('departments')
    .select('id')
    .eq('id', departmentId)
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  if (!data) throw new TeamError(404, 'Abteilung nicht gefunden')
  if (!canManageDepartmentMembers(ctx.scope, departmentId)) throw new TeamError(403, 'Keine Berechtigung')
}

/**
 * PUT /api/team/departments/:id/members  Body: { userId, role?: 'manager' | 'member' }
 * Nimmt auf oder ändert die Abteilungsrolle. Die Datenbank lässt nur
 * Mitglieder der Firma zu.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTeamContext()
    const { id } = await params
    await assertManager(ctx, id)
    const body = await request.json().catch(() => null)
    const role = body?.role ?? 'member'
    if (typeof body?.userId !== 'string' || !['manager', 'member'].includes(role)) {
      throw new TeamError(400, 'Ungültige Angaben')
    }

    const { error } = await ctx.db
      .from('department_members')
      .upsert({ department_id: id, user_id: body.userId, role }, { onConflict: 'department_id,user_id' })
    if (error) throw new TeamError(error.code === '23514' ? 400 : 500, error.code === '23514' ? 'Die Person gehört nicht zur Firma' : 'Speichern fehlgeschlagen')
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}

/** DELETE /api/team/departments/:id/members?userId=… */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTeamContext()
    const { id } = await params
    await assertManager(ctx, id)
    const userId = request.nextUrl.searchParams.get('userId')
    if (!userId) throw new TeamError(400, 'userId fehlt')
    await ctx.db.from('department_members').delete().eq('department_id', id).eq('user_id', userId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}
