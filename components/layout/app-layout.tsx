'use client'

import Sidebar from './sidebar'
import { DraftDrawerProvider } from '@/contexts/draft-drawer-context'
import { ContactDrawerProvider } from '@/contexts/contact-drawer-context'
import { ContactEditDrawerProvider } from '@/contexts/contact-edit-drawer-context'
import { IssuerDrawerProvider } from '@/contexts/issuer-drawer-context'
import { InvoiceDrawerProvider } from '@/contexts/invoice-drawer-context'
import DraftDrawer from '@/components/drafts/draft-drawer'
import ContactEditDrawer from '@/components/contacts/contact-edit-drawer'
import InvoiceDrawer from '@/components/invoices/invoice-drawer'
import { Toaster } from '@/components/ui/sonner'

interface AppLayoutProps {
  children: React.ReactNode
  companyName: string
  userEmail: string
  userName?: string | null
  companyId: string
}

export default function AppLayout({ children, companyName, userEmail, userName, companyId }: AppLayoutProps) {
  return (
    <DraftDrawerProvider>
      <ContactDrawerProvider>
        <ContactEditDrawerProvider>
          <IssuerDrawerProvider>
            <InvoiceDrawerProvider>
              <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
                {/* Sidebar */}
                <Sidebar companyName={companyName} userEmail={userEmail} userName={userName} />

                {/* Main Content */}
                <main className="flex-1 pl-80">
                  {children}
                </main>

                {/* Draft Drawer */}
                <DraftDrawer />
                
                {/* Contact Edit Drawer */}
                <ContactEditDrawer />

                {/* Invoice Drawer */}
                <InvoiceDrawer />
              </div>
              <Toaster />
            </InvoiceDrawerProvider>
          </IssuerDrawerProvider>
        </ContactEditDrawerProvider>
      </ContactDrawerProvider>
    </DraftDrawerProvider>
  )
}
