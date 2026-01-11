'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

interface ContactDrawerContextType {
  isOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
}

const ContactDrawerContext = createContext<ContactDrawerContextType | undefined>(undefined)

export function ContactDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const openDrawer = () => {
    setIsOpen(true)
  }

  const closeDrawer = () => {
    setIsOpen(false)
  }

  return (
    <ContactDrawerContext.Provider value={{ isOpen, openDrawer, closeDrawer }}>
      {children}
    </ContactDrawerContext.Provider>
  )
}

export function useContactDrawer() {
  const context = useContext(ContactDrawerContext)
  if (context === undefined) {
    throw new Error('useContactDrawer must be used within a ContactDrawerProvider')
  }
  return context
}
