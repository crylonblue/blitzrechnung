import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Rollen und Abteilungsrechte.
 *
 * Die Datenbank erzwingt dasselbe per RLS (Migration 043). Hier steht es noch
 * einmal, weil zwei Wege RLS umgehen oder nichts davon wissen:
 *
 *   - die öffentliche API arbeitet mit dem Dienstschlüssel,
 *   - Aktionen mit Nebenwirkung (Nummer vergeben, Mail versenden) dürfen nicht
 *     erst beim abschließenden UPDATE an der Policy scheitern — dann wäre die
 *     Rechnungsnummer schon verbraucht und im Nummernkreis eine Lücke.
 *
 * Wer die Matrix ändert, ändert sie in 043 und hier.
 */

export type CompanyRole = 'owner' | 'admin' | 'accountant' | 'member'
export type DepartmentRole = 'manager' | 'member'

export const COMPANY_ROLES: readonly CompanyRole[] = ['owner', 'admin', 'accountant', 'member']

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === 'string' && (COMPANY_ROLES as readonly string[]).includes(value)
}

/** Was ein Nutzer in einer Firma mit Rechnungen darf. */
export interface InvoiceScope {
  role: CompanyRole
  /** Abteilungen, in denen der Nutzer Mitglied ist. */
  departmentIds: string[]
  /** Abteilungen, die der Nutzer leitet (Teilmenge von `departmentIds`). */
  managedDepartmentIds: string[]
}

export type InvoiceAction = 'read' | 'write'

/** owner, admin und accountant sehen alle Rechnungen der Firma. */
export function seesAllDepartments(role: CompanyRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'accountant'
}

export function canManageTeam(role: CompanyRole): boolean {
  return role === 'owner' || role === 'admin'
}

/** Abrechnung, Firmendaten und Zugangsdaten bleiben beim Eigentümer. */
export function isOwner(role: CompanyRole): boolean {
  return role === 'owner'
}

export function canManageDepartmentMembers(scope: InvoiceScope, departmentId: string): boolean {
  return canManageTeam(scope.role) || scope.managedDepartmentIds.includes(departmentId)
}

export function canAccessInvoice(
  scope: InvoiceScope,
  departmentId: string | null | undefined,
  action: InvoiceAction
): boolean {
  if (action === 'write' && scope.role === 'accountant') return false
  if (action === 'read' && seesAllDepartments(scope.role)) return true
  if (action === 'write' && (scope.role === 'owner' || scope.role === 'admin')) return !!departmentId
  return !!departmentId && scope.departmentIds.includes(departmentId)
}

/**
 * Abteilungen, in die der Nutzer Rechnungen legen darf. `null` heißt: in jede
 * Abteilung der Firma (owner, admin), die Liste ist dann beim Aufrufer zu holen.
 */
export function writableDepartmentIds(scope: InvoiceScope): string[] | null {
  if (scope.role === 'accountant') return []
  if (scope.role === 'owner' || scope.role === 'admin') return null
  return scope.departmentIds
}

/**
 * Filter für Abfragen mit Dienstschlüssel: `null` = kein Filter nötig,
 * sonst nur diese Abteilungen. Mit Sitzungs-Client erledigt das RLS.
 */
export function readableDepartmentIds(scope: InvoiceScope): string[] | null {
  return seesAllDepartments(scope.role) ? null : scope.departmentIds
}

/**
 * Lädt Rolle und Abteilungen eines Nutzers in einer Firma. `null`, wenn er
 * nicht zur Firma gehört.
 */
export async function loadInvoiceScope(
  supabase: SupabaseClient,
  userId: string,
  companyId: string
): Promise<InvoiceScope | null> {
  const { data: membership } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (!membership || !isCompanyRole(membership.role)) return null

  // `departments!inner` begrenzt auf Abteilungen dieser Firma.
  const { data: rows } = await supabase
    .from('department_members')
    .select('department_id, role, departments!inner(company_id)')
    .eq('user_id', userId)
    .eq('departments.company_id', companyId)

  const departmentIds: string[] = []
  const managedDepartmentIds: string[] = []
  for (const row of (rows ?? []) as { department_id: string; role: DepartmentRole }[]) {
    departmentIds.push(row.department_id)
    if (row.role === 'manager') managedDepartmentIds.push(row.department_id)
  }

  return { role: membership.role, departmentIds, managedDepartmentIds }
}

/**
 * Wirft nicht selbst, damit der Aufrufer den Fehler in seinem Format ausgibt
 * (Session-Routen und v1-API antworten unterschiedlich).
 */
export async function userCanAccessInvoice(
  supabase: SupabaseClient,
  userId: string,
  invoice: { company_id: string; department_id?: string | null },
  action: InvoiceAction
): Promise<boolean> {
  const scope = await loadInvoiceScope(supabase, userId, invoice.company_id)
  if (!scope) return false
  return canAccessInvoice(scope, invoice.department_id, action)
}
