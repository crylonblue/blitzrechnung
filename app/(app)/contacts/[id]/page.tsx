import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ContactEditor from '@/components/contacts/contact-editor'

export default async function ContactPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !contact) {
    redirect('/contacts')
  }

  // Check if user has access
  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('company_id', contact.company_id)
    .single()

  if (!companyUsers) {
    redirect('/contacts')
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <ContactEditor contact={contact} />
    </div>
  )
}
