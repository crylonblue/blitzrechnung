import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import CompanySettings from '@/components/settings/company-settings'
import BillingSection from '@/components/settings/billing-section'
import { getBillingState, earlyBirdSlotsLeft } from '@/lib/billing'
import { loadPlanPricing } from '@/lib/stripe'
import { getAppSession } from '@/lib/app-session'

export default async function SettingsPage() {
  // Nutzer kommt aus dem pro Request gecachten Resolver. Die Rollenprüfung
  // unten bleibt eine eigene Abfrage: Sie filtert gezielt auf 'owner' und ist
  // damit etwas anderes als die reine Firmenzugehörigkeit.
  const { userId } = await getAppSession()
  const supabase = await createClient()

  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .limit(1)
    .single()

  if (!companyUsers) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="message-info">
          Sie haben keine Berechtigung, die Einstellungen zu ändern.
        </div>
      </div>
    )
  }

  const { data: company, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyUsers.company_id)
    .single()

  if (error || !company) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="message-error">
          Fehler beim Laden der Firmendaten: {error?.message}
        </div>
      </div>
    )
  }

  const [billing, pricing, slotsLeft] = await Promise.all([
    getBillingState(supabase, company.id),
    loadPlanPricing(),
    // Counting claimed launch slots needs to see every company's row, which RLS
    // rightly forbids. A missing service-role key just hides the offer.
    (async () => {
      try {
        return await earlyBirdSlotsLeft(createServiceRoleClient())
      } catch {
        return 0
      }
    })(),
  ])

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <CompanySettings
        company={company}
        billing={
          <BillingSection billing={billing} pricing={pricing} earlyBirdSlotsLeft={slotsLeft} />
        }
      />
    </div>
  )
}

