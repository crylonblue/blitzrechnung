'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ChevronRight, LoaderCircle, Pencil, Plus, Search, X } from 'lucide-react'

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

type InviteRole = 'admin' | 'accountant' | 'member'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Eigentümer',
  admin: 'Administrator',
  accountant: 'Buchhaltung',
  member: 'Mitglied',
}

const ROLE_HINT: Record<InviteRole, string> = {
  member: 'Legt Rechnungen in den eigenen Abteilungen an und bearbeitet sie.',
  accountant: 'Sieht alle Rechnungen und exportiert sie, ändert aber nichts.',
  admin: 'Sieht und bearbeitet alle Rechnungen, verwaltet Team und Einstellungen.',
}

/** Rollen, die alle Abteilungen sehen — eine Abteilungswahl ergäbe dort nichts. */
const SEES_ALL: string[] = ['owner', 'admin', 'accountant']

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

function initials(m: TeamMember): string {
  const source = displayName(m)
  const parts = source.includes('@') ? [source] : source.split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
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

function Avatar({ member }: { member: TeamMember }) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium"
      style={{ background: 'var(--bg-subtle, #ececec)', color: 'var(--text-secondary)' }}
      aria-hidden
    >
      {initials(member)}
    </div>
  )
}

function Chip({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs"
      style={{ borderColor: 'var(--border-default)', color: muted ? 'var(--text-meta)' : 'var(--text-secondary)' }}
    >
      {children}
    </span>
  )
}

export default function TeamManager({ currentUserId, isAdmin, isOwner, members, departments }: TeamManagerProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    if (ok) router.refresh()
    return ok
  }

  const departmentName = (id: string) => departments.find((d) => d.id === id)?.name ?? ''
  const selectedMember = members.find((m) => m.userId === memberId) ?? null
  const selectedDepartment = departments.find((d) => d.id === departmentId) ?? null

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => `${displayName(m)} ${m.email}`.toLowerCase().includes(q))
  }, [members, query])

  const resend = (m: TeamMember) =>
    run(async () => {
      const r = await call(`/api/team/members/${m.userId}/resend`, 'POST')
      if (r.ok) toast.success(`Einladung an ${m.email} erneut verschickt`)
      return r.ok
    })

  return (
    <div>
      <Tabs defaultValue="members">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <TabsList className="h-auto w-auto justify-start gap-8 rounded-none bg-transparent p-0">
            {([['members', 'Mitglieder', members.length], ['departments', 'Abteilungen', departments.length]] as const).map(([value, label, count]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pb-3 text-sm font-medium shadow-none transition-colors duration-150 hover:border-zinc-300 hover:text-zinc-900 data-[state=active]:border-zinc-900 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-zinc-900 data-[state=active]:shadow-none"
                style={{ color: 'var(--text-secondary)' }}
              >
                {label}
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-xs font-normal" style={{ background: 'rgba(45, 45, 45, 0.06)', color: 'var(--text-meta)' }}>
                  {count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <Button size="sm" className="mb-2" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Person einladen
          </Button>
        </div>

        {/* Mitglieder */}
        <TabsContent value="members" className="mt-6 space-y-3">
          {members.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-meta)' }} />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name oder E-Mail suchen"
                className="pl-9"
                aria-label="Mitglieder suchen"
              />
            </div>
          )}
          <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {visibleMembers.length === 0 && <div className="px-5 py-8 text-center text-meta">Niemand gefunden.</div>}
            {visibleMembers.map((m) => {
              const self = m.userId === currentUserId
              const sortedDepartments = [...m.departments].sort((a, b) => departmentName(a.id).localeCompare(departmentName(b.id)))
              const shown = sortedDepartments.slice(0, 3)
              const more = sortedDepartments.length - shown.length
              return (
                <div key={m.userId} className="flex items-center gap-2 pr-3 hover:bg-black/[0.02]">
                  <button
                    type="button"
                    onClick={() => setMemberId(m.userId)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 text-left"
                  >
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{displayName(m)}</span>
                        {self && <span className="text-meta">Sie</span>}
                      </div>
                      {displayName(m) !== m.email && <div className="truncate text-meta">{m.email}</div>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {m.pending && <Chip muted>Eingeladen</Chip>}
                        {SEES_ALL.includes(m.role) ? (
                          <span className="text-meta">Alle Abteilungen</span>
                        ) : m.departments.length === 0 ? (
                          <span className="text-xs text-amber-700">Keine Abteilung – sieht keine Rechnungen</span>
                        ) : (
                          <>
                            {shown.map((d) => (
                              <Chip key={d.id}>
                                {departmentName(d.id)}
                                {d.role === 'manager' && ' · Leitung'}
                              </Chip>
                            ))}
                            {more > 0 && <Chip muted>+{more}</Chip>}
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-right text-sm text-secondary">{ROLE_LABEL[m.role]}</span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-meta)' }} />
                  </button>
                  {isAdmin && m.pending && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => resend(m)}>
                      Erneut senden
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </TabsContent>

        {/* Abteilungen */}
        <TabsContent value="departments" className="mt-6 space-y-3">
          <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {departments.map((d) => {
              const inDepartment = members.filter((m) => m.departments.some((x) => x.id === d.id))
              const leads = inDepartment.filter((m) => m.departments.find((x) => x.id === d.id)?.role === 'manager')
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDepartmentId(d.id)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-black/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{d.name}</span>
                      {d.isDefault && <Chip muted>Standard</Chip>}
                    </div>
                    <div className="truncate text-meta">
                      {inDepartment.length === 0
                        ? 'Noch keine Mitglieder'
                        : `${inDepartment.length} ${inDepartment.length === 1 ? 'Mitglied' : 'Mitglieder'}${leads.length > 0 ? ` · Leitung: ${leads.map(displayName).join(', ')}` : ''}`}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-meta)' }} />
                </button>
              )
            })}
          </div>
          {isAdmin && (
            <Button variant="outline" onClick={() => setDepartmentDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Abteilung anlegen
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        isAdmin={isAdmin}
        departments={departments}
        onDone={() => router.refresh()}
      />

      <NewDepartmentDialog
        open={departmentDialogOpen}
        onOpenChange={setDepartmentDialogOpen}
        onDone={() => router.refresh()}
      />

      <MemberSheet
        member={selectedMember}
        onClose={() => setMemberId(null)}
        self={selectedMember?.userId === currentUserId}
        isAdmin={isAdmin}
        isOwner={isOwner}
        departments={departments}
        busy={busy}
        run={run}
        onResend={resend}
      />

      <DepartmentSheet
        department={selectedDepartment}
        onClose={() => setDepartmentId(null)}
        isAdmin={isAdmin}
        members={members}
        busy={busy}
        run={run}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Einladen                                                            */
/* ------------------------------------------------------------------ */

function InviteDialog({
  open,
  onOpenChange,
  isAdmin,
  departments,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isAdmin: boolean
  departments: TeamDepartment[]
  onDone: () => void
}) {
  const defaultSelection = () => {
    // Wer nur eine Abteilung wählen kann, bekommt sie vorbelegt; sonst die Standardabteilung.
    const preset = departments.length === 1 ? departments[0] : departments.find((d) => d.isDefault)
    return preset ? [preset.id] : []
  }
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [selected, setSelected] = useState<string[]>(defaultSelection)
  const [busy, setBusy] = useState(false)

  const effectiveRole: InviteRole = isAdmin ? role : 'member'
  const needsDepartments = effectiveRole === 'member'
  const addresses = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const canSubmit = addresses.length > 0 && (!needsDepartments || selected.length > 0)

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((d) => d !== id) : [...cur, id]))

  const submit = async () => {
    setBusy(true)
    const failed: string[] = []
    let notMailed = 0
    for (const email of addresses) {
      const r = await call('/api/team/invites', 'POST', {
        email,
        role: effectiveRole,
        departmentIds: needsDepartments ? selected : [],
      })
      if (!r.ok) failed.push(email)
      else if (!r.data?.emailSent) notMailed++
    }
    setBusy(false)
    const sent = addresses.length - failed.length
    if (sent > 0) {
      toast.success(sent === 1 ? 'Einladung verschickt' : `${sent} Einladungen verschickt`)
      onDone()
    }
    if (notMailed > 0) toast.warning('Bei einer Einladung ging die Mail nicht raus. Bitte in der Liste „Erneut senden“.')
    if (failed.length === 0) {
      setEmails('')
      setSelected(defaultSelection())
      onOpenChange(false)
    } else {
      // Nur die gescheiterten Adressen bleiben stehen, damit man korrigieren und es nochmal versuchen kann.
      setEmails(failed.join('\n'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Person einladen</DialogTitle>
          <DialogDescription>
            Die Person bekommt eine Mail mit einem Link zum Anmelden. Ein Passwort ist nicht nötig.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit && !busy) submit()
          }}
        >
          <div>
            <Label htmlFor="invite-email">E-Mail-Adresse</Label>
            <Input
              id="invite-email"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoFocus
              className="mt-1.5"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="name@firma.de"
            />
            <p className="mt-1.5 text-meta">
              {addresses.length > 1 ? `${addresses.length} Adressen` : 'Mehrere Adressen mit Komma oder Leerzeichen trennen.'}
            </p>
          </div>

          {isAdmin && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Rolle</legend>
              <div className="space-y-2">
                {(['member', 'accountant', 'admin'] as const).map((r) => (
                  <label
                    key={r}
                    className="flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3"
                    style={{
                      borderColor: role === r ? 'var(--text-primary)' : 'var(--border-default)',
                      background: role === r ? 'rgba(45, 45, 45, 0.04)' : 'transparent',
                    }}
                  >
                    <input type="radio" name="invite-role" className="mt-1" checked={role === r} onChange={() => setRole(r)} />
                    <span>
                      <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                      <span className="block text-meta">{ROLE_HINT[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {needsDepartments ? (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Abteilungen</legend>
              <div className="flex flex-wrap gap-2">
                {departments.map((d) => {
                  const on = selected.includes(d.id)
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggle(d.id)}
                      aria-pressed={on}
                      className="rounded-md border px-3 py-1.5 text-sm"
                      style={{
                        borderColor: on ? 'var(--text-primary)' : 'var(--border-default)',
                        background: on ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                      }}
                    >
                      {d.name}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-meta">Das Mitglied sieht nur Rechnungen dieser Abteilungen.</p>
            </fieldset>
          ) : (
            <p className="text-meta">Diese Rolle sieht alle Rechnungen, eine Abteilung ist nicht nötig.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {addresses.length > 1 ? `${addresses.length} Einladungen senden` : 'Einladung senden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Abteilung anlegen                                                   */
/* ------------------------------------------------------------------ */

function NewDepartmentDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await call('/api/team/departments', 'POST', { name })
    setBusy(false)
    if (r.ok) {
      setName('')
      onOpenChange(false)
      onDone()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abteilung anlegen</DialogTitle>
          <DialogDescription>Rechnungen gehören immer genau einer Abteilung.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !busy) submit()
          }}
        >
          <div>
            <Label htmlFor="new-department">Name</Label>
            <Input id="new-department" autoFocus className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Vertrieb" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Person bearbeiten                                                   */
/* ------------------------------------------------------------------ */

/** Zweistufiges Bestätigen ohne Browser-Dialog: erst „Entfernen“, dann „Wirklich entfernen?“. */
function ConfirmButton({ label, confirmLabel, disabled, onConfirm }: { label: string; confirmLabel: string; disabled?: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <Button variant="outline" disabled={disabled} onClick={() => setArmed(true)} className="text-red-600">
        {label}
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        disabled={disabled}
        className="bg-red-600 text-white hover:bg-red-700"
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Abbrechen
      </Button>
    </div>
  )
}

function MemberSheet({
  member,
  onClose,
  self,
  isAdmin,
  isOwner,
  departments,
  busy,
  run,
  onResend,
}: {
  member: TeamMember | null
  onClose: () => void
  self: boolean
  isAdmin: boolean
  isOwner: boolean
  departments: TeamDepartment[]
  busy: boolean
  run: (fn: () => Promise<boolean>) => Promise<boolean>
  onResend: (m: TeamMember) => void
}) {
  const canEditRole = !!member && isAdmin && !self && (isOwner || member.role !== 'owner')
  const canRemove = canEditRole
  const seesAll = !!member && SEES_ALL.includes(member.role)

  return (
    <Sheet open={!!member} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-md">
        {member && (
          <>
            <SheetHeader className="p-0 pr-10">
              <div className="flex items-center gap-3">
                <Avatar member={member} />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{displayName(member)}</SheetTitle>
                  <SheetDescription className="truncate">
                    {displayName(member) !== member.email ? member.email : member.pending ? 'Noch nicht angemeldet' : ' '}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide">Rolle</h3>
              {canEditRole ? (
                <Select
                  value={member.role}
                  disabled={busy}
                  onValueChange={(value) => run(async () => (await call(`/api/team/members/${member.userId}`, 'PATCH', { role: value })).ok)}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isOwner && <SelectItem value="owner">{ROLE_LABEL.owner}</SelectItem>}
                    <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                    <SelectItem value="accountant">{ROLE_LABEL.accountant}</SelectItem>
                    <SelectItem value="member">{ROLE_LABEL.member}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm">{ROLE_LABEL[member.role]}</p>
              )}
              {member.role !== 'owner' && <p className="text-meta">{ROLE_HINT[member.role as InviteRole]}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide">Abteilungen</h3>
              {seesAll ? (
                <p className="text-meta">Diese Rolle sieht alle Rechnungen der Firma.</p>
              ) : (
                <>
                  <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                    {departments.map((d) => {
                      const link = member.departments.find((x) => x.id === d.id)
                      return (
                        <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm">{d.name}</div>
                            {link && (
                              <button
                                type="button"
                                disabled={busy}
                                className="text-meta underline-offset-2 hover:underline"
                                onClick={() =>
                                  run(async () =>
                                    (await call(`/api/team/departments/${d.id}/members`, 'PUT', {
                                      userId: member.userId,
                                      role: link.role === 'manager' ? 'member' : 'manager',
                                    })).ok
                                  )
                                }
                              >
                                {link.role === 'manager' ? 'Leitung · zu Mitglied machen' : 'Mitglied · zur Leitung machen'}
                              </button>
                            )}
                          </div>
                          <Switch
                            checked={!!link}
                            disabled={busy}
                            aria-label={`${d.name}: ${link ? 'entfernen' : 'hinzufügen'}`}
                            onCheckedChange={(on) =>
                              run(async () =>
                                on
                                  ? (await call(`/api/team/departments/${d.id}/members`, 'PUT', { userId: member.userId, role: 'member' })).ok
                                  : (await call(`/api/team/departments/${d.id}/members?userId=${member.userId}`, 'DELETE')).ok
                              )
                            }
                          />
                        </li>
                      )
                    })}
                  </ul>
                  {member.departments.length === 0 && (
                    <p className="text-meta">Ohne Abteilung sieht diese Person keine Rechnungen.</p>
                  )}
                </>
              )}
            </section>

            {(isAdmin && member.pending) || canRemove ? (
              <section className="mt-auto flex flex-col items-start gap-3 border-t pt-5" style={{ borderColor: 'var(--border-default)' }}>
                {isAdmin && member.pending && (
                  <Button variant="outline" disabled={busy} onClick={() => onResend(member)}>
                    Einladung erneut senden
                  </Button>
                )}
                {canRemove && (
                  <ConfirmButton
                    label="Aus dem Team entfernen"
                    confirmLabel="Ja, entfernen"
                    disabled={busy}
                    onConfirm={async () => {
                      const ok = await run(async () => (await call(`/api/team/members/${member.userId}`, 'DELETE')).ok)
                      if (ok) onClose()
                    }}
                  />
                )}
                {canRemove && <p className="text-meta">Ein API-Schlüssel der Person wird dabei ebenfalls gelöscht.</p>}
              </section>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* Abteilung bearbeiten                                                */
/* ------------------------------------------------------------------ */

function DepartmentSheet({
  department,
  onClose,
  isAdmin,
  members,
  busy,
  run,
}: {
  department: TeamDepartment | null
  onClose: () => void
  isAdmin: boolean
  members: TeamMember[]
  busy: boolean
  run: (fn: () => Promise<boolean>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Beim Wechsel der Abteilung Namen und Bearbeitungsmodus zurücksetzen.
  if (department && editingId !== department.id) {
    setEditingId(department.id)
    setName(department.name)
    setRenaming(false)
  }
  if (!department && editingId !== null) setEditingId(null)

  const inDepartment = department ? members.filter((m) => m.departments.some((x) => x.id === department.id)) : []
  const candidates = department ? members.filter((m) => !SEES_ALL.includes(m.role) && !m.departments.some((x) => x.id === department.id)) : []

  const saveName = async () => {
    if (!department || !name.trim() || name.trim() === department.name) return setRenaming(false)
    const ok = await run(async () => (await call(`/api/team/departments/${department.id}`, 'PATCH', { name })).ok)
    if (ok) setRenaming(false)
  }

  return (
    <Sheet open={!!department} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-6 overflow-y-auto p-6 sm:max-w-md">
        {department && (
          <>
            <SheetHeader className="space-y-2 p-0 pr-12">
              {renaming ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveName()
                  }}
                >
                  <Input autoFocus aria-label="Name der Abteilung" value={name} onChange={(e) => setName(e.target.value)} />
                  <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                    Speichern
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setName(department.name); setRenaming(false) }}>
                    Abbrechen
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <SheetTitle className="truncate text-lg">{department.name}</SheetTitle>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label="Abteilung umbenennen"
                      onClick={() => setRenaming(true)}
                      className="rounded p-1 hover:bg-black/5"
                      style={{ color: 'var(--text-meta)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {department.isDefault && <Chip muted>Standard</Chip>}
                <Chip muted>{inDepartment.length} {inDepartment.length === 1 ? 'Mitglied' : 'Mitglieder'}</Chip>
              </div>
              <SheetDescription>
                {department.isDefault
                  ? 'Hier landen neue Rechnungen, wenn nichts anderes gewählt ist.'
                  : 'Die Rechnungen sehen die Mitglieder sowie Admins und Buchhaltung.'}
              </SheetDescription>
            </SheetHeader>

            <section className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide">Mitglieder</h3>
              {inDepartment.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-meta">
                  Noch niemand in dieser Abteilung.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {inDepartment.map((m) => {
                    const link = m.departments.find((x) => x.id === department.id)!
                    const lead = link.role === 'manager'
                    return (
                      <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                        <Avatar member={m} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{displayName(m)}</div>
                          {displayName(m) !== m.email && <div className="truncate text-meta">{m.email}</div>}
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          aria-pressed={lead}
                          title={lead ? 'Leitung entziehen' : 'Zur Leitung machen'}
                          onClick={() =>
                            run(async () => (await call(`/api/team/departments/${department.id}/members`, 'PUT', { userId: m.userId, role: lead ? 'member' : 'manager' })).ok)
                          }
                          className="rounded-md border px-2.5 py-1 text-xs transition-colors"
                          style={{
                            borderColor: lead ? 'var(--text-primary)' : 'var(--border-default)',
                            background: lead ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                            color: lead ? 'var(--text-primary)' : 'var(--text-secondary)',
                          }}
                        >
                          Leitung
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`${displayName(m)} aus der Abteilung entfernen`}
                          onClick={() => run(async () => (await call(`/api/team/departments/${department.id}/members?userId=${m.userId}`, 'DELETE')).ok)}
                          className="rounded p-1.5 hover:bg-black/5"
                          style={{ color: 'var(--text-meta)' }}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {candidates.length > 0 && (
                <Select
                  value=""
                  disabled={busy}
                  onValueChange={(userId) => run(async () => (await call(`/api/team/departments/${department.id}/members`, 'PUT', { userId, role: 'member' })).ok)}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="+ Mitglied hinzufügen" /></SelectTrigger>
                  <SelectContent>
                    {candidates.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>{displayName(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>

            {isAdmin && !department.isDefault && (
              <section className="mt-auto space-y-2 border-t border-zinc-200 pt-5">
                <ConfirmButton
                  label="Abteilung löschen"
                  confirmLabel="Ja, löschen"
                  disabled={busy}
                  onConfirm={async () => {
                    const ok = await run(async () => (await call(`/api/team/departments/${department.id}`, 'DELETE')).ok)
                    if (ok) onClose()
                  }}
                />
                <p className="text-meta">Nur möglich, solange keine Rechnungen oder Entwürfe in der Abteilung liegen.</p>
              </section>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
