'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

interface ContactEditDrawerContextType {
  isOpen: boolean
  contactId: string | null
  openDrawer: (contactId: string | null) => void
  closeDrawer: () => void
}

const ContactEditDrawerContext = createContext<ContactEditDrawerContextType | undefined>(undefined)

export function ContactEditDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [contactId, setContactId] = useState<string | null>(null)

  const openDrawer = (id: string | null) => {
    setContactId(id)
    setIsOpen(true)
  }

  const closeDrawer = () => {
    setIsOpen(false)
    setContactId(null)
  }

  return (
    <ContactEditDrawerContext.Provider value={{ isOpen, contactId, openDrawer, closeDrawer }}>
      {children}
    </ContactEditDrawerContext.Provider>
  )
}

export function useContactEditDrawer() {
  const context = useContext(ContactEditDrawerContext)
  if (context === undefined) {
    throw new Error('useContactEditDrawer must be used within a ContactEditDrawerProvider')
  }
  return context
}
