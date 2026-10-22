'use client'

import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { BellRing, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Invoice } from '@/types'
import DunningDrawer from './dunning-drawer'
import type { DunningStatus } from './dunning-api'

/**
 * „Dokument hinzufügen" — der Weg zu einem neuen Beleg an dieser Rechnung.
 *
 * Er steht unter der Dokumentenliste, weil dort die Dokumente stehen. Vorher
 * war es ein Knopf im Aktionsstapel ganz unten, der den Namen der nächsten
 * Mahnstufe trug („1. Mahnung") — das war **eine** Tür, und sie führte immer
 * nur an die eine Stelle, die der Server gerade vorschlug. Wer die Stufe
 * wechseln wollte, musste erst hindurchgehen und dann drinnen unter „Anpassen"
 * suchen.
 *
 * **Die Auswahl ist eine Liste von Dokumentarten, nicht von Mahnstufen.** Das
 * ist der Punkt, an dem diese Form etwas aushält: Heute füllen nur die
 * eingerichteten Mahnstufen die Liste, aber jede weitere Art — eine Notiz, ein
 * hochgeladener Beleg, eine Zahlungsbestätigung — ist ein weiterer Eintrag
 * nach demselben Muster (Name, ein Satz dazu, ein Klick), ohne dass dieser
 * Knopf oder die Liste darüber umgebaut werden müssten. Deshalb trägt die
 * innere Struktur bereits `DokumentArt` und nicht „Stufe".
 *
 * **Aufklappen statt schwebendem Menü.** Diese Liste lebt in einer Schublade,
 * aus der gleich eine zweite Schublade aufgeht; ein schwebendes Menü müsste
 * sich in diese Staffelung einfügen (siehe die Ebenenrechnung im Kopf von
 * `dunning-drawer.tsx`), eine Liste, die den Platz einfach einnimmt, muss das
 * nicht. Dass der Knopf ein gewöhnlicher Knopf bleibt und kein `<summary>`
 * ist, hat einen zweiten Grund: Er trägt dieselbe Betonung wie zuvor der
 * Mahnknopf im Aktionsstapel, und `aria-expanded` sagt Hilfsmitteln ohnehin,
 * was er tut.
 */

/** „21. Okt 2026" — gleiche Schreibweise wie in der Dokumentenliste. */
function tag(iso: string): string {
  const [jahr, monat, t] = iso.split('-').map(Number)
  return format(new Date(jahr, monat - 1, t), 'd. MMM yyyy', { locale: de })
}

/**
 * Eine Art von Dokument, die sich hier anlegen lässt.
 *
 * `hinweis` ist der Satz, der dem Nutzer die Wahl abnimmt — wann diese Art an
 * der Reihe ist, oder warum sie es gerade nicht ist. `gesperrt` heisst: steht
 * in der Liste, lässt sich aber nicht wählen; verschweigen wäre schlechter,
 * denn die Stufe ist eingerichtet und der Nutzer sucht sie.
 */
interface DokumentArt {
  id: string
  name: string
  hinweis: string
  gesperrt: boolean
  /** Symbol links — bei Mahnungen dasselbe wie in der Liste darüber. */
  symbol: React.ReactNode
  onWaehlen: () => void
}

interface AddDocumentProps {
  invoice: Invoice
  status: DunningStatus
  empfaenger: string
  absender: string
  /** Mahnen ist der wahrscheinliche nächste Schritt. */
  betont: boolean
  /** Dokument entstanden — Rechnung und Mahnstatus neu laden. */
  onCreated: () => void
  /** Die Schublade meldet „längst bezahlt" — die Rechnungsschublade geht zu. */
  onPaid: () => void
}

export default function AddDocument({
  invoice,
  status,
  empfaenger,
  absender,
  betont,
  onCreated,
  onPaid,
}: AddDocumentProps) {
  const [offen, setOffen] = useState(false)
  const [schubladeOffen, setSchubladeOffen] = useState(false)
  const [jeGeoeffnet, setJeGeoeffnet] = useState(false)
  /** Welche Stufe gewählt wurde; `null` heisst „die, die ohnehin dran ist". */
  const [gewaehlteStufe, setGewaehlteStufe] = useState<number | null>(null)
  const knopfRef = useRef<HTMLButtonElement>(null)

  const oeffne = (position: number | null) => {
    setGewaehlteStufe(position)
    setJeGeoeffnet(true)
    setSchubladeOffen(true)
    setOffen(false)
  }

  /**
   * Die vorgeschlagene Stufe zuerst.
   *
   * `status.stufe` ist die, die der Server von sich aus schreiben würde. Sie
   * steht oben und ist der einzige Eintrag, der mit dem Zeitplan begründet
   * wird („vorgesehen ab …"); die übrigen stehen darunter in ihrer natürlichen
   * Reihenfolge. Wer nichts weiss, nimmt den ersten und liegt richtig.
   */
  const vorgeschlagen = status.stufe?.position ?? null

  const arten: DokumentArt[] = status.stufen
    .map((stufe) => {
      const istVorschlag = stufe.position === vorgeschlagen
      const hinweis = stufe.bereitsErstellt
        ? 'Zu dieser Stufe besteht bereits eine Mahnung.'
        : istVorschlag && !status.istFaellig && status.faelligAb
          ? `Nach Ihrem Zeitplan ab ${tag(status.faelligAb)} vorgesehen — früher geht auch.`
          : istVorschlag
            ? 'Der nächste Schritt nach Ihrem Zeitplan.'
            : 'Mahnstufe überspringen und direkt hier ansetzen.'

      return {
        id: `stufe-${stufe.position}`,
        name: `${stufe.position}. ${stufe.name}`,
        hinweis,
        gesperrt: stufe.bereitsErstellt,
        symbol: <BellRing className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />,
        onWaehlen: () => oeffne(stufe.position),
      }
    })
    // Der Vorschlag nach oben, der Rest behält seine Reihenfolge.
    .sort((a, b) =>
      a.id === `stufe-${vorgeschlagen}` ? -1 : b.id === `stufe-${vorgeschlagen}` ? 1 : 0
    )

  /**
   * Zweifel am Zugang der **Rechnung**, nicht der Mahnung.
   *
   * `created` ist der einzige Status, in dem die Rechnung nachweislich nie
   * draussen war — jeder Versand hebt sie auf `sent` (siehe
   * `nextStatusAfterSend`). Verzug setzt nach § 286 Abs. 3 BGB aber den Zugang
   * der Rechnung voraus. Bewusst nur ein Hinweis und keine Sperre: `created`
   * kann genauso heissen, dass die Rechnung per Post ging und niemand den
   * Status gepflegt hat; wer per Post verschickt, darf deswegen nicht
   * ausgesperrt werden.
   */
  const zugangFraglich = invoice.status === 'created'

  return (
    <div className="mt-3">
      {zugangFraglich && (
        <p
          className="mb-2 text-xs text-zinc-500 dark:text-zinc-400"
          title={'Verzug setzt nach § 286 Abs. 3 BGB den Zugang der Rechnung voraus. Haben Sie die Rechnung per Post verschickt, setzen Sie den Status oben auf „Versendet".'}
        >
          Diese Rechnung ist nicht als versendet markiert. Verzug setzt voraus,
          dass sie beim Empfänger angekommen ist.
        </p>
      )}

      <Button
        ref={knopfRef}
        type="button"
        variant={betont ? 'default' : 'outline'}
        className="w-full"
        aria-expanded={offen}
        onClick={() => setOffen((vorher) => !vorher)}
      >
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        Dokument hinzufügen
      </Button>

      {offen && (
        <ul className="mt-2 space-y-1">
          {arten.map((art) => (
            <li key={art.id}>
              <button
                type="button"
                disabled={art.gesperrt}
                onClick={art.onWaehlen}
                className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-zinc-800"
              >
                <span className="mt-0.5 shrink-0">{art.symbol}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {art.name}
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {art.hinweis}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Erst bei Bedarf einhängen, dann aber eingehängt lassen: Die
          Schublade bringt ihre eigene Öffnungsbewegung mit, und ein Ausbauen
          beim Schliessen schnitte sie ab. */}
      {jeGeoeffnet && (
        <DunningDrawer
          invoice={invoice}
          empfaenger={empfaenger}
          absender={absender}
          basis={status}
          startStufe={gewaehlteStufe}
          isOpen={schubladeOffen}
          onClose={() => setSchubladeOffen(false)}
          onCreated={onCreated}
          onPaid={onPaid}
          oeffnerRef={knopfRef}
        />
      )}
    </div>
  )
}
