'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Invoice } from '@/types'
import DunningDialog from './dunning-dialog'
import { ladeMahnstatus, verwirfMahnung, type DunningStatus } from './dunning-api'

/**
 * Das Mahnwesen in der Rechnungs-Schublade.
 *
 * Der ganze sichtbare Teil des Mahnwesens besteht aus diesem Block: ein Knopf
 * und eine Zeile Verlauf, beides nur bei überfälligen Rechnungen. Kein
 * Menüpunkt, keine Spalte in der Tabelle, kein eigener Bildschirm — wer nie
 * mahnt, sieht davon nichts.
 *
 * Der Knopf trägt den **Namen der Stufe**, nicht das Wort „Mahnen". Stufe 1
 * ist eine Zahlungserinnerung; sie „Mahnung" zu nennen beschreibt sie falsch
 * und lässt den ersten Klick schwerer wiegen, als er ist.
 */

/** „21.10." — im Verlauf zählt der Tag, nicht das Jahr. */
function kurz(iso: string): string {
  const [, monat, tag] = iso.split('-')
  return `${tag}.${monat}.`
}

interface DunningSectionProps {
  invoice: Invoice
  /** Name des Empfängers, von der Schublade schon aufgelöst. */
  empfaenger: string
  /** Name der eigenen Firma. */
  absender: string
  /** Die Schublade lädt die Rechnung neu (Status, Verlauf). */
  onChanged: () => void
  /** Die Rechnung ist bezahlt — die Schublade geht zu. */
  onPaid: () => void
}

export default function DunningSection({
  invoice,
  empfaenger,
  absender,
  onChanged,
  onPaid,
}: DunningSectionProps) {
  const router = useRouter()
  const [status, setStatus] = useState<DunningStatus | null>(null)
  const [dialogOffen, setDialogOffen] = useState(false)
  const [verwerfeId, setVerwerfeId] = useState<string | null>(null)

  const laden = useCallback(
    (signal?: AbortSignal) =>
      ladeMahnstatus(invoice.id, {}, signal)
        .then((neu) => setStatus(neu))
        .catch(() => {
          // Bewusst still. Solange die Route fehlt oder klemmt, zeigt die
          // Schublade einfach kein Mahnwesen — eine Fehlermeldung an dieser
          // Stelle wäre Lärm über eine Funktion, nach der niemand gefragt hat.
          if (!signal?.aborted) setStatus(null)
        }),
    [invoice.id]
  )

  useEffect(() => {
    const controller = new AbortController()
    laden(controller.signal)
    return () => controller.abort()
  }, [laden])

  const handleVerwerfen = async (reminderId: string) => {
    setVerwerfeId(reminderId)
    try {
      await verwirfMahnung(reminderId)
      toast.success('Entwurf verworfen')
      await laden()
      onChanged()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Der Entwurf konnte nicht verworfen werden.')
    } finally {
      setVerwerfeId(null)
    }
  }

  // Noch nichts geladen, oder die Rechnung ist gar nicht mahnbar: null Pixel.
  if (!status || (!status.mahnbar && status.verlauf.length === 0)) return null

  const letzte = status.verlauf.length > 0 ? status.verlauf[status.verlauf.length - 1] : null
  const entwurf = status.verlauf.find((eintrag) => eintrag.status === 'created') ?? null

  // Der Knopf nur, wenn die Stufe auch wirklich dran ist. Ist sie es noch
  // nicht, sagt die Verlaufszeile ab wann — das ist die ehrlichere Auskunft
  // als ein Knopf, der dann eine Fehlermeldung bringt.
  const zeigeKnopf = status.mahnbar && status.stufe !== null && status.istFaellig

  /**
   * Die Verlaufszeile, aus höchstens zwei Teilen: was zuletzt geschrieben
   * wurde und was als nächstes möglich ist — „Zahlungserinnerung am 21.10. ·
   * 1. Mahnung ab 04.11. möglich".
   */
  const verlaufsTeile: string[] = []
  if (letzte) {
    verlaufsTeile.push(
      `${letzte.stage_name} am ${kurz(letzte.reminder_date)}${letzte.status === 'created' ? ' (Entwurf)' : ''}`
    )
  }
  if (status.alleStufenDurchlaufen) {
    // Nicht einfach den Knopf verschwinden lassen: Dass es nichts mehr zu
    // eskalieren gibt, ist ein Ergebnis und keine Lücke.
    verlaufsTeile.push('alle Mahnstufen durchlaufen')
  } else if (status.stufe && !status.istFaellig && status.faelligAb) {
    verlaufsTeile.push(`${status.stufe.name} ab ${kurz(status.faelligAb)} möglich`)
  } else if (!letzte && status.stufe) {
    verlaufsTeile.push('noch nicht gemahnt')
  }

  return (
    <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      {zeigeKnopf && status.stufe && (
        <Button variant="outline" className="w-full" onClick={() => setDialogOffen(true)}>
          <BellRing className="mr-2 h-4 w-4" />
          {status.stufe.name}
        </Button>
      )}

      {verlaufsTeile.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {verlaufsTeile.join(' · ')}
        </p>
      )}

      {/* Ein Entwurf ist noch nichts Verschicktes — er muss sich zurücknehmen
          lassen, ohne dass man ihn anderswo suchen müsste. */}
      {entwurf && (
        <button
          type="button"
          onClick={() => handleVerwerfen(entwurf.id)}
          disabled={verwerfeId === entwurf.id}
          className="mt-1 inline-flex items-center text-xs text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {verwerfeId === entwurf.id && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />}
          Entwurf verwerfen
        </button>
      )}

      {/* Erst bei Bedarf einhängen: Der Dialog rechnet beim Öffnen auf dem
          Stand, den dieser Block schon geholt hat. */}
      {dialogOffen && (
        <DunningDialog
          invoice={invoice}
          empfaenger={empfaenger}
          absender={absender}
          basis={status}
          isOpen={dialogOffen}
          onClose={() => setDialogOffen(false)}
          onCreated={() => {
            laden()
            onChanged()
          }}
          onPaid={onPaid}
        />
      )}
    </div>
  )
}
