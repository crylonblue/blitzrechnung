import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getAppSession } from '@/lib/app-session'
import ContactEditor from '@/components/contacts/contact-editor'

export default async function ContactPage({ params }: { params: { id: string } }) {
  const { companyIds } = await getAppSession()
  const supabase = await createClient()

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !contact) {
    redirect('/contacts')
  }

  // Zugriffsprüfung gegen die bereits geladenen Zugehörigkeiten.
  if (!companyIds.includes(contact.company_id)) {
    redirect('/contacts')
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <ContactEditor contact={contact} />
    </div>
  )
}
