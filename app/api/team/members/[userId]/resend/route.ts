import { NextRequest, NextResponse } from 'next/server'
import { canManageTeam } from '@/lib/access'
import { createLoginToken, sendInviteMail } from '@/lib/login-token'
import { getTeamContext, teamErrorResponse, TeamError } from '@/lib/team'

/** POST /api/team/members/:userId/resend — Einladungsmail erneut senden (nur solange ausstehend). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await getTeamContext()
    if (!canManageTeam(ctx.scope.role)) throw new TeamError(403, 'Keine Berechtigung')
    const { userId } = await params

    const { data: member } = await ctx.db
      .from('company_users')
      .select('invite_pending, user_profiles(email)')
      .eq('company_id', ctx.companyId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!member) throw new TeamError(404, 'Mitglied nicht gefunden')
    if (!member.invite_pending) throw new TeamError(409, 'Die Person hat sich bereits angemeldet')

    const profile = Array.isArray(member.user_profiles) ? member.user_profiles[0] : member.user_profiles
    const email = (profile as { email: string | null } | null)?.email
    if (!email) throw new TeamError(404, 'Mitglied nicht gefunden')

    const [{ data: company }, { data: inviter }] = await Promise.all([
      ctx.db.from('companies').select('name').eq('id', ctx.companyId).single(),
      ctx.db.from('user_profiles').select('name').eq('id', ctx.userId).single(),
    ])
    const token = await createLoginToken(ctx.db, email, request.nextUrl.origin)
    await sendInviteMail(email, token, { companyName: company?.name ?? 'einem Unternehmen', inviterName: inviter?.name ?? null })
    return NextResponse.json({ success: true })
  } catch (err) {
    return teamErrorResponse(err)
  }
}
