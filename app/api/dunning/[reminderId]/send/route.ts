import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userCanAccessInvoice } from '@/lib/access'
import { assertCompanyMembership, InvoiceServiceError } from '@/lib/invoice-service'
import { meldeFehler } from '@/lib/observability'
import { DunningServiceError, versendeMahnung } from '@/lib/dunning-service'

/**
 * Eine bereits erstellte Mahnung per E-Mail verschicken.
 *
 * Der gewöhnliche Weg führt nicht hierher: In der Schublade macht „Mahnung
 * senden" beides in einem Zug (anlegen, erzeugen, verschicken), und das
 * erledigt `app/api/invoices/[id]/dunning`. Diese Route ist der **zweite
 * Anlauf** — für das Dokument, das mit „Nur erstellen" entstanden ist und doch
 * noch per E-Mail hinaus soll, und für den Versand, der beim ersten Mal nicht
 * durchkam. Beide Fälle haben dasselbe gemeinsam: Das Mahnschreiben existiert
 * bereits und wird nicht neu erzeugt.
 *
 * Ohne Angaben im Rumpf gilt der vorbereitete Text (`baueMahnungsMail`) —
 * derselbe, den die Schublade zeigt. Deshalb braucht der Knopf in der
 * Belegübersicht keinen eigenen Bildschirm.
 */
export async function POST(
  request: NextRequest,
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
    // der Verwerfen-Route nebenan. Die RLS zieht dieselbe Grenze ein zweites
    // Mal; diese Prüfung steht davor, damit der Nutzer einen Satz bekommt
    // statt einer leeren Antwort.
    const { data: zeile } = await supabase
      .from('payment_reminders')
      .select('company_id, invoice_id')
      .eq('id', reminderId)
      .single()
    if (!zeile) return NextResponse.json({ error: 'Mahnung nicht gefunden' }, { status: 404 })
    await assertCompanyMembership(supabase, user.id, zeile.company_id)
    const { data: rechnung } = await supabase.from('invoices').select('company_id, department_id').eq('id', zeile.invoice_id).single()
    if (!rechnung || !(await userCanAccessInvoice(supabase, user.id, rechnung, 'write'))) {
      return NextResponse.json({ error: 'Keine Berechtigung für Rechnungen dieser Abteilung' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const ergebnis = await versendeMahnung(
      supabase,
      { companyId: zeile.company_id },
      {
        reminderId,
        recipientEmail: typeof body.recipientEmail === 'string' ? body.recipientEmail : null,
        subject: typeof body.subject === 'string' ? body.subject : undefined,
        // Ein leerer Text ist eine Entscheidung des Nutzers („nur der Anhang")
        // und etwas anderes als „nicht angegeben". Deshalb die Prüfung auf den
        // Typ und nicht auf den Inhalt.
        body: typeof body.body === 'string' ? body.body : undefined,
      }
    )

    return NextResponse.json({
      success: true,
      empfaengerEmail: ergebnis.empfaengerEmail,
      erneut: ergebnis.erneut,
      rechnungsStatus: ergebnis.rechnungsStatus,
      mahnung: ergebnis.mahnung,
    })
  } catch (err) {
    if (err instanceof InvoiceServiceError || err instanceof DunningServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    meldeFehler(err, { bereich: 'dunning.versand' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
