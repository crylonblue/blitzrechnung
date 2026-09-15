import AppLayout from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { getBillingState } from '@/lib/billing'
import { getAppSession } from '@/lib/app-session'

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Vorher: getUser() → company_users → companies → user_profiles → Abrechnung,
  // fünf Aufrufe streng nacheinander. Der Resolver bündelt die ersten vier zu
  // zwei (ein Auth-Aufruf, ein eingebetteter Select) und teilt das Ergebnis mit
  // den Seiten darunter, die es bisher allesamt erneut geholt haben.
  const session = await getAppSession()
  const supabase = await createClient()
  const billing = await getBillingState(supabase, session.companyId)

  return (
    <AppLayout
      companyName={session.companyName}
      userEmail={session.email}
      userName={session.userName ?? undefined}
      companyId={session.companyId}
      inTrial={billing.inTrial}
      entitled={billing.entitled}
      trialDaysLeft={billing.trialDaysLeft}
    >
      {children}
    </AppLayout>
  )
}
