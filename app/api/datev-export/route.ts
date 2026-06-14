import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PartySnapshot, LineItem } from '@/types'
import {
  generateDatevBuchungsstapel,
  DATEV_ACCOUNT_DEFAULTS,
  type DatevSettings,
  type DatevInvoice,
  type SkrVariant,
} from '@/lib/datev-generator'

// GET /api/datev-export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Streams a DATEV-Format (EXTF) Buchungsstapel CSV for the date range.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) {
    return NextResponse.json({ error: 'Parameter "from" und "to" sind erforderlich' }, { status: 400 })
  }

  // Resolve the user's company (first one, like the dashboard).
  const { data: companyUsers } = await supabase
    .from('company_users')
    .select('company_id')
    .eq('user_id', user.id)
  const companyId = companyUsers?.[0]?.company_id
  if (!companyId) {
    return NextResponse.json({ error: 'Keine Firma gefunden' }, { status: 400 })
  }

  const { data: company } = await supabase
    .from('companies')
    .select('datev_settings')
    .eq('id', companyId)
    .single()

  const ds = (company?.datev_settings || null) as Partial<DatevSettings> | null
  if (!ds?.berater_nr || !ds?.mandanten_nr) {
    return NextResponse.json(
      { error: 'Bitte zuerst Berater- und Mandantennummer unter Einstellungen → Buchhaltung hinterlegen.' },
      { status: 400 }
    )
  }

  const skr: SkrVariant = ds.skr === 'SKR04' ? 'SKR04' : 'SKR03'
  const settings: DatevSettings = {
    skr,
    berater_nr: ds.berater_nr,
    mandanten_nr: ds.mandanten_nr,
    wj_beginn: ds.wj_beginn || '0101',
    sachkontenlaenge: ds.sachkontenlaenge || 4,
    debitor_konto: ds.debitor_konto || DATEV_ACCOUNT_DEFAULTS[skr].debitor_konto,
    erloes_konten: ds.erloes_konten || DATEV_ACCOUNT_DEFAULTS[skr],
  }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('invoice_number, invoice_date, invoice_type, buyer_snapshot, line_items')
    .eq('company_id', companyId)
    .neq('status', 'draft')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .order('invoice_date', { ascending: true })

  const datevInvoices: DatevInvoice[] = (invoices || []).map((inv) => ({
    invoice_number: inv.invoice_number || '',
    invoice_date: inv.invoice_date || from,
    invoice_type: inv.invoice_type === 'cancellation' ? 'cancellation' : 'invoice',
    buyer_name: (inv.buyer_snapshot as PartySnapshot | null)?.name || 'Unbekannt',
    line_items: ((inv.line_items as unknown as LineItem[]) || []).map((li) => ({
      quantity: li.quantity,
      unit_price: li.unit_price,
      vat_rate: li.vat_rate,
      tax_category: li.tax_category,
      exemption_reason: li.exemption_reason,
    })),
  }))

  const result = generateDatevBuchungsstapel(datevInvoices, settings, { from, to }, new Date())

  return new NextResponse(new Uint8Array(result.content), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=windows-1252',
      'Content-Disposition': `attachment; filename="EXTF_Buchungsstapel_${from}_${to}.csv"`,
      'X-Datev-Bookings': String(result.bookingCount),
      'X-Datev-Skipped': String(result.skipped.length),
    },
  })
}
