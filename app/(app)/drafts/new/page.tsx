import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NewDraftClient from './new-draft-client'

export default async function NewDraftPage() {
  const supabase = await createClient()
  
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: companyUser } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!companyUser) {
    redirect('/onboarding')
  }

  return <NewDraftClient companyId={companyUser.company_id} />
}
