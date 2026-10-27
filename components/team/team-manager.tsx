'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoaderCircle, Trash2 } from 'lucide-react'

export interface TeamMember {
  userId: string
  role: 'owner' | 'admin' | 'accountant' | 'member'
  /** Eingeladen, aber noch nie angemeldet. */
  pending: boolean
  name: string | null
  email: string
  /** Abteilungen, die der Betrachter sehen darf. */
  departments: { id: string; role: 'manager' | 'member' }[]
}
export interface TeamDepartment {
  id: string
  name: string
  isDefault: boolean
}
const ROLE_LABEL: Record<string, string> = {
  owner: 'Eigentümer',
  admin: 'Administrator',
  accountant: 'Buchhaltung',
  member: 'Mitglied',
}

const ROLE_HINT: Record<string, string> = {
  admin: 'Alle Rechnungen, Team und Abteilungen verwalten',
  accountant: 'Alle Rechnungen ansehen und exportieren, nichts ändern',
  member: 'Rechnungen der eigenen Abteilungen anlegen und bearbeiten',
}

interface TeamManagerProps {
  currentUserId: string
  isAdmin: boolean
  isOwner: boolean
  members: TeamMember[]
  departments: TeamDepartment[]
}

/** Konten, die per Einladung entstehen, tragen die Mailadresse als Namen. */
function displayName(m: TeamMember): string {
  return m.name && m.name !== m.email ? m.name : m.email
}

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) toast.error(data?.error ?? 'Das hat nicht geklappt')
  return { ok: res.ok, data }
}

export default function TeamManager({ currentUserId, isAdmin, isOwner, members, departments }: TeamManagerProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'accountant' | 'member'>('member')
  const [inviteDepartments, setInviteDepartments] = useState<string[]>([])
  const [newDepartment, setNewDepartment] = useState('')

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    if (ok) router.refresh()
  }

  const invite = () =>
    run(async () => {
      const r = await call('/api/team/invites', 'POST', {
        email,
        role: isAdmin ? role : 'member',
        departmentIds: inviteDepartments,
      })
      if (r.ok) {
        setEmail('')
        setInviteDepartments([])
        if (r.data.emailSent) toast.success('Einladung verschickt')
        else toast.warning('Die Person ist angelegt, die Mail ging aber nicht raus. Bitte „Erneut senden“ versuchen.')
      }
      return r.ok
    })

  const toggleInviteDepartment = (id: string) =>
    setInviteDepartments((cur) => (cur.includes(id) ? cur.filter((d) => d !== id) : [...cur, id]))

  const departmentRole = (member: TeamMember, departmentId: string) =>
    member.departments.find((d) => d.id === departmentId)?.role

  return (
    <div className="space-y-12">
      {/* Mitglieder */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide">Mitglieder</h2>
        <div className="card divide-y" style={{ borderColor: 'var(--border-default)' }}>
          {members.map((m) => {
            const self = m.userId === currentUserId
            const canEditRole = isAdmin && !self && (isOwner || m.role !== 'owner')
            return (
              <div key={m.userId} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {displayName(m)}{self && ' (Sie)'}
                    {m.pending && <span className="ml-2 text-meta">eingeladen</span>}
                  </div>
                  {displayName(m) !== m.email && <div className="truncate text-meta">{m.email}</div>}
                </div>
                <div className="flex items-center gap-3">
                  {canEditRole ? (
                    <Select
                      value={m.role}
                      onValueChange={(value) => run(async () => (await call(`/api/team/members/${m.userId}`, 'PATCH', { role: value })).ok)}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isOwner && <SelectItem value="owner">{ROLE_LABEL.owner}</SelectItem>}
                        <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                        <SelectItem value="accountant">{ROLE_LABEL.accountant}</SelectItem>
                        <SelectItem value="member">{ROLE_LABEL.member}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm text-secondary">{ROLE_LABEL[m.role]}</span>
                  )}
                  {isAdmin && m.pending && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await call(`/api/team/members/${m.userId}/resend`, 'POST')
                          if (r.ok) toast.success('Einladung erneut verschickt')
                          return r.ok
                        })
                      }
                    >
                      Erneut senden
                    </Button>
                  )}
                  {isAdmin && !self && (isOwner || m.role !== 'owner') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label="Aus dem Team entfernen"
                      onClick={() => {
                        if (confirm(`${displayName(m)} aus dem Team entfernen? Ein API-Schlüssel der Person wird ebenfalls gelöscht.`)) {
                          run(async () => (await call(`/api/team/members/${m.userId}`, 'DELETE')).ok)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Abteilungen */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide">Abteilungen</h2>
        <div className="space-y-4">
          {departments.map((d) => {
            const inDepartment = members.filter((m) => departmentRole(m, d.id))
            const candidates = members.filter((m) => !departmentRole(m, d.id))
            return (
              <div key={d.id} className="card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm font-medium">{d.name}{d.isDefault && <span className="ml-2 text-meta">Standard</span>}</div>
                  {isAdmin && !d.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Abteilung ${d.name} löschen`}
                      onClick={() => confirm(`Abteilung „${d.name}“ löschen?`) && run(async () => (await call(`/api/team/departments/${d.id}`, 'DELETE')).ok)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <ul className="mt-3 space-y-2">
                  {inDepartment.length === 0 && <li className="text-meta">Noch keine Mitglieder.</li>}
                  {inDepartment.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{displayName(m)}</span>
                      <span className="flex items-center gap-2">
                        <Select
                          value={departmentRole(m, d.id)}
                          onValueChange={(value) => run(async () => (await call(`/api/team/departments/${d.id}/members`, 'PUT', { userId: m.userId, role: value })).ok)}
                          disabled={busy}
                        >
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Mitglied</SelectItem>
                            <SelectItem value="manager">Leitung</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label="Aus der Abteilung entfernen"
                          onClick={() => run(async () => (await call(`/api/team/departments/${d.id}/members?userId=${m.userId}`, 'DELETE')).ok)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>

                {isAdmin && candidates.length > 0 && (
                  <div className="mt-4">
                    <Select
                      value=""
                      onValueChange={(userId) => run(async () => (await call(`/api/team/departments/${d.id}/members`, 'PUT', { userId, role: 'member' })).ok)}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-64"><SelectValue placeholder="Mitglied hinzufügen …" /></SelectTrigger>
                      <SelectContent>
                        {candidates.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>{displayName(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )
          })}

          {isAdmin && (
            <form
              className="flex items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                run(async () => {
                  const r = await call('/api/team/departments', 'POST', { name: newDepartment })
                  if (r.ok) setNewDepartment('')
                  return r.ok
                })
              }}
            >
              <div className="flex-1">
                <Label htmlFor="new-department">Neue Abteilung</Label>
                <Input id="new-department" className="mt-1.5" value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} placeholder="z.B. Vertrieb" />
              </div>
              <Button type="submit" disabled={busy || !newDepartment.trim()}>Anlegen</Button>
            </form>
          )}
        </div>
      </section>

      {/* Einladen */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide">Person einladen</h2>
        <div className="card space-y-4 p-5">
          <div>
            <Label htmlFor="invite-email">E-Mail-Adresse</Label>
            <Input id="invite-email" type="email" className="mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" />
          </div>
          {isAdmin && (
            <div>
              <Label htmlFor="invite-role">Rolle</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="invite-role" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['member', 'accountant', 'admin'] as const).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-meta">{ROLE_HINT[role]}</p>
            </div>
          )}
          {(role === 'member' || !isAdmin) && (
            <div>
              <Label>Abteilungen</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {departments.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleInviteDepartment(d.id)}
                    className="rounded-md border px-3 py-1.5 text-sm"
                    style={{
                      borderColor: 'var(--border-default)',
                      background: inviteDepartments.includes(d.id) ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                    }}
                    aria-pressed={inviteDepartments.includes(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-meta">Ohne Abteilung sieht ein Mitglied keine Rechnungen.</p>
            </div>
          )}
          <Button onClick={invite} disabled={busy || !email.trim() || (!isAdmin && inviteDepartments.length === 0)}>
            {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            Einladen
          </Button>
        </div>
      </section>
    </div>
  )
}
