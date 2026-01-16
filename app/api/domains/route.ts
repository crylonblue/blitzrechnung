import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDomain, deleteDomain, createServer } from '@/lib/postmark'
import { EmailSettings } from '@/types'

/**
 * POST /api/domains - Register a custom sender domain
 */
export async function POST(request: NextRequest) {
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

  // Only owners can manage email settings
  if (companyUser.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can manage email settings' }, { status: 403 })
  }

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
    // Get current email settings and company name
    const { data: company } = await supabase
      .from('companies')
      .select('email_settings, name')
      .eq('id', companyUser.company_id)
      .single()

    const currentSettings = (company?.email_settings as EmailSettings) || { mode: 'default' }

    // If there's an existing Postmark domain, delete it first
    if (currentSettings.postmark_domain_id) {
      try {
        await deleteDomain(currentSettings.postmark_domain_id)
      } catch (err) {
        console.error('Failed to delete existing domain:', err)
        // Continue anyway - it might not exist in Postmark
      }
    }

    // Reuse existing server if available, otherwise create a new one
    let serverResult: { postmark_server_id: number; postmark_server_token: string }
    
    if (currentSettings.postmark_server_id && currentSettings.postmark_server_token) {
      // Reuse existing server
      serverResult = {
        postmark_server_id: currentSettings.postmark_server_id,
        postmark_server_token: currentSettings.postmark_server_token,
      }
    } else {
      // Create a new Postmark server for this user's custom domain
      serverResult = await createServer(domain)
    }

    // Create new domain in Postmark
    const domainResult = await createDomain(domain)

    // Update company email settings with both server and domain info
    const newSettings: EmailSettings = {
      mode: 'custom_domain',
      reply_to_email: reply_to_email || undefined,
      custom_domain: domain,
      from_email,
      from_name,
      domain_verified: false,
      postmark_domain_id: domainResult.postmark_domain_id,
      postmark_server_id: serverResult.postmark_server_id,
      postmark_server_token: serverResult.postmark_server_token,
      dns_records: domainResult.dns_records,
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ email_settings: newSettings })
      .eq('id', companyUser.company_id)

    if (updateError) {
      // Try to clean up the Postmark domain (keep server for reuse)
      try {
        await deleteDomain(domainResult.postmark_domain_id)
      } catch {}
      throw updateError
    }

    return NextResponse.json({
      success: true,
      domain,
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
export async function DELETE(request: NextRequest) {
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

  // Only owners can manage email settings
  if (companyUser.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can manage email settings' }, { status: 403 })
  }

  try {
    // Get current email settings
    const { data: company } = await supabase
      .from('companies')
      .select('email_settings')
      .eq('id', companyUser.company_id)
      .single()

    const currentSettings = (company?.email_settings as EmailSettings) || { mode: 'default' }

    // Delete domain in Postmark if exists
    if (currentSettings.postmark_domain_id) {
      try {
        await deleteDomain(currentSettings.postmark_domain_id)
      } catch (err) {
        console.error('Failed to delete domain:', err)
        // Continue anyway
      }
    }

    // Keep the server for reuse - Postmark has restrictions on server deletion
    // and we want to allow users to re-add a domain without issues

    // Reset to default settings but keep server info for reuse
    const newSettings: EmailSettings = {
      mode: 'default',
      reply_to_email: currentSettings.reply_to_email,
      reply_to_name: currentSettings.reply_to_name,
      invoice_email_subject: currentSettings.invoice_email_subject,
      invoice_email_body: currentSettings.invoice_email_body,
      // Keep server info for reuse when adding a new domain
      postmark_server_id: currentSettings.postmark_server_id,
      postmark_server_token: currentSettings.postmark_server_token,
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update({ email_settings: newSettings })
      .eq('id', companyUser.company_id)

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
