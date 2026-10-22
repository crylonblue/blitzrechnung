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
 *
 * Die Rahmung (Trennlinie, Abstand nach oben) liegt bewusst nicht hier,
 * sondern beim Aktionsbereich der Schublade: Mahnstufe, Downloads, Versand
 * und Storno stehen dort in **einem** Stapel, und eine eigene Trennlinie
 * mitten darin würde ihn zerschneiden.
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
  /**
   * Die Mahnstufe ist der wahrscheinliche nächste Schritt und steht im
   * Aktionsbereich ganz oben — dann trägt der Knopf auch das Gewicht dafür.
   * Sonst bleibt er eine Nebenaktion unter den Downloads.
   */
  betont?: boolean
}

export default function DunningSection({
  invoice,
  empfaenger,
  absender,
  onChanged,
  onPaid,
  betont = false,
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
   * Zweifel am Zugang: `created` ist der einzige Status, in dem die Rechnung
   * nachweislich noch nie draussen war — jeder Versand hebt sie auf `sent`
   * (siehe nextStatusAfterSend in lib/invoice-service), `reminded` und `paid`
   * stehen ohnehin weiter. `uneinbringlich` erreicht diese Zeile nicht, weil
   * eine abgeschriebene Forderung serverseitig gar nicht mahnbar ist.
   *
   * Bewusst nur ein Hinweis, keine Sperre: `created` kann genauso heissen,
   * dass die Rechnung per Post ging und niemand den Status gepflegt hat. Das
   * kann die Software nicht wissen — und wer per Post verschickt, darf
   * deswegen nicht ausgesperrt werden.
   */
  const zugangFraglich = invoice.status === 'created'

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
    <div>
      {/* Der Hinweis steht über dem Knopf, nicht darunter: Die Zeile darunter
          gehört dem Mahnverlauf, und wer liest, soll den Zweifel vor dem Klick
          sehen. Volltext samt Ausweg im title — wie bei „Zum Fertigstellen
          fehlt noch: …" im Entwurfseditor. */}
      {zeigeKnopf && zugangFraglich && (
        <p
          className="mb-2 text-xs text-zinc-500 dark:text-zinc-400"
          title={'Verzug setzt nach § 286 Abs. 3 BGB den Zugang der Rechnung voraus. Haben Sie die Rechnung per Post verschickt, setzen Sie den Status oben auf „Versendet".'}
        >
          Diese Rechnung ist nicht als versendet markiert. Verzug setzt voraus,
          dass sie beim Empfänger angekommen ist.
        </p>
      )}

      {zeigeKnopf && status.stufe && (
        <Button
          variant={betont ? 'default' : 'outline'}
          className="w-full"
          onClick={() => setDialogOffen(true)}
        >
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
