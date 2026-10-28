import { NextRequest, NextResponse } from 'next/server'
import { canManageTeam } from '@/lib/access'
import { getTeamContext, teamErrorResponse, TeamError } from '@/lib/team'

/** POST /api/team/departments  Body: { name } */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTeamContext()
    if (!canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) throw new TeamError(400, 'Name fehlt')

    const { data, error } = await ctx.db
      .from('departments')
      .insert({ company_id: ctx.companyId, name })
      .select('id, name')
      .single()
    if (error) {
      throw new TeamError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'Eine Abteilung mit diesem Namen gibt es schon' : 'Abteilung konnte nicht angelegt werden')
    }
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return teamErrorResponse(err)
  }
}
