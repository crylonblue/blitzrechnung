import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadLogoToS3, deleteLogoFromS3 } from '@/lib/s3'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

/**
 * POST /api/logo
 * Upload a company logo
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's company (owner or admin)
    const { data: companyUser } = await supabase
      .from('company_users')
      .select('company_id, role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .single()

    if (!companyUser) {
      return NextResponse.json(
        { error: 'Sie haben keine Berechtigung, das Logo zu ändern' },
        { status: 403 }
      )
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('logo') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'Keine Datei hochgeladen' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Ungültiger Dateityp. Erlaubt sind: PNG, JPG' },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Datei ist zu groß. Maximal 5MB erlaubt.' },
        { status: 400 }
      )
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to S3
    const logoUrl = await uploadLogoToS3(
      companyUser.company_id,
      buffer,
      file.type
    )

    // Update company with new logo URL
    const { error: updateError } = await supabase
      .from('companies')
      .update({ logo_url: logoUrl })
      .eq('id', companyUser.company_id)

    if (updateError) {
      console.error('Error updating company logo_url:', updateError)
      return NextResponse.json(
        { error: 'Fehler beim Speichern der Logo-URL' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      logo_url: logoUrl,
    })
  } catch (error) {
    console.error('Error uploading logo:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/logo
 * Remove a company logo
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's company (owner or admin)
    const { data: companyUser } = await supabase
      .from('company_users')
      .select('company_id, role')
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .single()

    if (!companyUser) {
      return NextResponse.json(
        { error: 'Sie haben keine Berechtigung, das Logo zu ändern' },
        { status: 403 }
      )
    }

    // Delete from S3
    await deleteLogoFromS3(companyUser.company_id)

    // Update company to remove logo URL
    const { error: updateError } = await supabase
      .from('companies')
      .update({ logo_url: null })
      .eq('id', companyUser.company_id)

    if (updateError) {
      console.error('Error removing company logo_url:', updateError)
      return NextResponse.json(
        { error: 'Fehler beim Entfernen der Logo-URL' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('Error deleting logo:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
