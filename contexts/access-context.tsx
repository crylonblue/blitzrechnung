'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CompanyRole } from '@/lib/access'
import type { SessionDepartment } from '@/lib/app-session'

interface AccessContextType {
  role: CompanyRole
  /** Abteilungen der Firma, mit Angabe, wo der Nutzer Rechnungen anlegen darf. */
  departments: SessionDepartment[]
  /** Darf der Nutzer überhaupt Rechnungen anlegen? Nicht so die Buchhaltung. */
  canWriteInvoices: boolean
}

const AccessContext = createContext<AccessContextType | undefined>(undefined)

export function AccessProvider({
  role,
  departments,
  children,
}: {
  role: CompanyRole
  departments: SessionDepartment[]
  children: ReactNode
}) {
  const canWriteInvoices = departments.some((d) => d.writable)
  return (
    <AccessContext.Provider value={{ role, departments, canWriteInvoices }}>
      {children}
    </AccessContext.Provider>
  )
}

export function useAccess() {
  const context = useContext(AccessContext)
  if (context === undefined) {
    throw new Error('useAccess must be used within an AccessProvider')
  }
  return context
}
