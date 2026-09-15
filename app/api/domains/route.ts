import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDomain, deleteDomain } from '@/lib/email'
import { EmailSettings } from '@/types'

/**
 * Either the response to send back, or the company the caller may act on.
 * The `never` members let TypeScript narrow on `if (auth.error)`.
 */
type OwnerResult =
  | { error: NextResponse; companyId?: never }
  | { error?: never; companyId: string }

/**
 * Resolve the caller's company and make sure they may change email settings.
 */
async function requireOwner(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<OwnerResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: companyUser } = await supabase
    .from('company_users')
    .select('company_id, role')
    .eq('user_id', user.id)
    .single()

  if (!companyUser) {
    return { error: NextResponse.json({ error: 'No company found' }, { status: 404 }) }
  }

  if (companyUser.role !== 'owner') {
    return {
      error: NextResponse.json({ error: 'Only owners can manage email settings' }, { status: 403 }),
    }
  }

  return { companyId: companyUser.company_id as string }
}

/**
 * POST /api/domains - Register a custom sender domain
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const auth = await requireOwner(supabase)
  if (auth.error) return auth.error

  const body = await request.json()
  const { from_email, from_name, reply_to_email } = body

  if (!from_email || !from_name) {
    return NextResponse.json(
      { error: 'from_email and from_name are required' },
      { status: 400 }
    )
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(from_email)) {
    return NextResponse.json(
      { error: 'Invalid email format' },
      { status: 400 }
    )
  }

  // Extract domain from email
  const domain = from_email.split('@')[1]

  try {
    const { data: company } = await supabase
      .from('companies')
      .select('email_settings')
      .eq('id', auth.companyId)
      .single()

    const currentSettings = (company?.email_settings as EmailSettings) || { mode: 'default' }

    // Drop a previously registered domain so a changed sender address does not
    // leave an orphan behind in the provider account.
    if (currentSettings.provider === 'ahasend' && currentSettings.custom_domain) {
      if (currentSettings.custom_domain !== domain) {
        try {
          await deleteDomain(currentSettings.custom_domain)
        } catch (err) {
          console.error('Failed to delete existing domain:', err)
          // Continue anyway - it might already be gone.
        }
      }
    }

    const domainResult = await createDomain(domain)

    const newSettings: EmailSettings = {
      ...currentSettings,
      mode: 'custom_domain',
      reply_to_email: reply_to_email || undefined,
      custom_domain: domain,
      from_email,
      from_name,
      domain_verified: domainResult.verified,
      domain_verified_at: domainResult.verified ? new Date().toISOString() : undefined,
      provider: 'ahasend',
      dns_records: domainResult.dns_records,
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ email_settings: newSettings })
      .eq('id', auth.companyId)

    if (updateError) {
      // Roll the provider back so we do not keep a domain we cannot reach.
      try {
        await deleteDomain(domain)
      } catch {}
      throw updateError
    }

    return NextResponse.json({
      success: true,
      domain,
      verified: domainResult.verified,
      dns_records: domainResult.dns_records,
    })
  } catch (err) {
    console.error('Error creating sender domain:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create sender domain' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/domains - Remove custom domain and switch back to default
 */
export async function DELETE() {
  const supabase = await createClient()

  const auth = await requireOwner(supabase)
  if (auth.error) return auth.error

  try {
    const { data: company } = await supabase
      .from('companies')
      .select('email_settings')
      .eq('id', auth.companyId)
      .single()

    const currentSettings = (company?.email_settings as EmailSettings) || { mode: 'default' }

    if (currentSettings.provider === 'ahasend' && currentSettings.custom_domain) {
      try {
        await deleteDomain(currentSettings.custom_domain)
      } catch (err) {
        console.error('Failed to delete domain:', err)
        // Continue anyway - the local settings should still be reset.
      }
    }

    // Reset to the shared sender, keeping everything unrelated to the domain.
    const newSettings: EmailSettings = {
      mode: 'default',
      reply_to_email: currentSettings.reply_to_email,
      reply_to_name: currentSettings.reply_to_name,
      invoice_email_subject: currentSettings.invoice_email_subject,
      invoice_email_body: currentSettings.invoice_email_body,
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ email_settings: newSettings })
      .eq('id', auth.companyId)

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error removing sender domain:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to remove sender domain' },
      { status: 500 }
    )
  }
}
