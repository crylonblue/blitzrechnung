import { createClient } from '@/lib/supabase/server'
import { getAppSession } from '@/lib/app-session'
import ContactsTable from '@/components/contacts/contacts-table'
import ContactsPageHeader from '@/components/contacts/contacts-page-header'
import ContactsEmptyState from '@/components/contacts/contacts-empty-state'

export default async function ContactsPage() {
  // Nutzer und Firmen kommen aus dem pro Request gecachten Resolver.
  const { companyIds } = await getAppSession()
  const supabase = await createClient()

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

  // Für die Duplikat-Hinweise in der Import-Vorschau.
  const existingContacts = (contacts || []).map((c) => ({
    name: c.name,
    zip: (c.address as { zip?: string } | null)?.zip || '',
  }))

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <ContactsPageHeader existingContacts={existingContacts} />

      {contacts && contacts.length === 0 ? (
        <ContactsEmptyState />
      ) : (
        <ContactsTable contacts={contacts || []} />
      )}
    </div>
  )
}
