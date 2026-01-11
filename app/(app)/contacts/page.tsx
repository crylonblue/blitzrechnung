import { createClient } from '@/lib/supabase/server'
import ContactsTable from '@/components/contacts/contacts-table'
import ContactsPageHeader from '@/components/contacts/contacts-page-header'
import ContactsEmptyState from '@/components/contacts/contacts-empty-state'

export default async function ContactsPage() {
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)

  const companyIds = companyUsers?.map((cu) => cu.company_id) || []

  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('*')
    .in('company_id', companyIds)
    .order('name')

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="message-error">
          Fehler beim Laden der Kontakte: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <ContactsPageHeader />

      {contacts && contacts.length === 0 ? (
        <ContactsEmptyState />
      ) : (
        <ContactsTable contacts={contacts || []} />
      )}
    </div>
  )
}
