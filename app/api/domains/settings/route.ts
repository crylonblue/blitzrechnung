import { canManageTeam, type CompanyRole } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { EmailSettings } from '@/types'

/**
 * PATCH /api/domains/settings - Update email settings (reply-to, mode)
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the user's company
  const { data: companyUser } = await supabase
    .from('company_users')
    .select('company_id, role')
    .eq('user_id', user.id)
    .single()

  if (!companyUser) {
    return NextResponse.json({ error: 'No company found' }, { status: 404 })
  }

  // Only owners and admins can manage email settings
  if (!canManageTeam(companyUser.role as CompanyRole)) {
    return NextResponse.json({ error: 'Only owners and admins can manage email settings' }, { status: 403 })
  }

  const body = await request.json()
  const { reply_to_email, reply_to_name, mode, invoice_email_subject, invoice_email_body } = body

  try {
    // Get current email settings
    const { data: company } = await supabase
      .from('companies')
      .select('email_settings')
      .eq('id', companyUser.company_id)
      .single()

    const currentSettings = (company?.email_settings as EmailSettings) || { mode: 'default' }

    // Build updated settings
    const newSettings: EmailSettings = {
      ...currentSettings,
    }

    if (reply_to_email !== undefined) {
      newSettings.reply_to_email = reply_to_email || undefined
    }

    if (reply_to_name !== undefined) {
      newSettings.reply_to_name = reply_to_name || undefined
    }

    // Invoice email template fields
    if (invoice_email_subject !== undefined) {
      newSettings.invoice_email_subject = invoice_email_subject || undefined
    }

    if (invoice_email_body !== undefined) {
      newSettings.invoice_email_body = invoice_email_body || undefined
    }

    // Only allow switching to default mode (switching to custom_domain requires POST /api/domains)
    if (mode === 'default' && currentSettings.mode === 'custom_domain') {
      // Keep the custom domain config but switch mode
      newSettings.mode = 'default'
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ email_settings: newSettings })
      .eq('id', companyUser.company_id)

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({ success: true, settings: newSettings })
  } catch (err) {
    console.error('Error updating email settings:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update email settings' },
      { status: 500 }
    )
  }
}
