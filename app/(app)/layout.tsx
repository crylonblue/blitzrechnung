import AppLayout from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user's first company
  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  // Redirect to onboarding if user has no company
  if (!companyUsers) {
    redirect('/onboarding')
  }

  const companyId = companyUsers.company_id
  let companyName = 'Mein Unternehmen'
  
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', companyUsers.company_id)
    .single()
  
  if (company) {
    companyName = company.name
  }

  // Get user profile
  const { data: userProfile } = await supabase
    .from('user_profiles')
    .select('name, email')
    .eq('id', user.id)
    .single()

  return (
    <AppLayout
      companyName={companyName}
      userEmail={userProfile?.email || user.email || ''}
      userName={userProfile?.name}
      companyId={companyId}
    >
      {children}
    </AppLayout>
  )
}

