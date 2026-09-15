import { getAppSession } from '@/lib/app-session'
import NewDraftClient from './new-draft-client'

export default async function NewDraftPage() {
  // Der Resolver hat Nutzer und Firma bereits aufgelöst und leitet selbst nach
  // /login bzw. /onboarding um, wenn eines davon fehlt.
  const { companyId } = await getAppSession()

  return <NewDraftClient companyId={companyId} />
}
