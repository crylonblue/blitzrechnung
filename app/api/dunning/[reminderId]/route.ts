import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertCompanyMembership, InvoiceServiceError } from '@/lib/invoice-service'
import { meldeFehler } from '@/lib/observability'
import { DunningServiceError, verwerfeMahnung } from '@/lib/dunning-service'

/**
 * Eine **noch nicht versendete** Mahnung verwerfen.
 *
 * Sie ist kein Entwurf mehr: Ihr Mahnschreiben ist erzeugt und abgelegt, sie
 * steht in der Belegübersicht und lässt sich herunterladen. Was ihr fehlt, ist
 * der Versand — und solange der nicht war, darf sie spurlos verschwinden.
 *
 * Die Route liegt bewusst nicht unter der Rechnung: Eine Mahnung hat eine
 * eigene Kennung, und der Dialog kennt sie aus dem Verlauf. Eine zweite
 * Kennung im Pfad mitzuschleppen, die serverseitig ohnehin nicht geprüft
 * werden kann, ohne sie gegen die Mahnung abzugleichen, brächte nichts.
 *
 * Versendete Mahnungen lassen sich hier nicht löschen — das setzt
 * `verwerfeMahnung` über `status = 'created'` durch, und die Löschregel der
 * Tabelle ein zweites Mal. Ein verschicktes Schreiben ist ein Handelsbrief; es
 * wird abgelöst, nicht entfernt.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ reminderId: string }> }
) {
  const { reminderId } = await params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Erst die Zeile, dann die Firmenzugehörigkeit — dasselbe Muster wie in
    // `app/api/invoices/finalize/route.ts`. `verwerfeMahnung` grenzt zusätzlich
    // selbst auf die Firma ein; doppelt, weil die Prüfung hier den
    // verständlichen Fehler liefert und dort den tatsächlichen Schutz.
    const { data: mahnung } = await supabase
      .from('payment_reminders')
      .select('company_id')
      .eq('id', reminderId)
      .single()
    if (!mahnung) return NextResponse.json({ error: 'Mahnung nicht gefunden' }, { status: 404 })
    await assertCompanyMembership(supabase, user.id, mahnung.company_id)

    await verwerfeMahnung(supabase, { companyId: mahnung.company_id }, reminderId)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof InvoiceServiceError || err instanceof DunningServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    meldeFehler(err, { bereich: 'dunning.verwerfen' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
