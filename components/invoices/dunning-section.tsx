'use client'

import { useRef, useState } from 'react'
import { BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Invoice } from '@/types'
import DunningDrawer from './dunning-drawer'
import type { DunningStatus } from './dunning-api'

/**
 * Die Mahnaktion in der Rechnungs-Schublade.
 *
 * Dieser Block ist jetzt genau **eine Aktion**: der Knopf für die nächste
 * Mahnstufe, dazu der Hinweis auf den fraglichen Zugang. Alles, was den
 * *Zustand* betrifft — welche Mahnungen es gibt, was sie forderten, was als
 * nächstes ansteht —, steht in der Dokumentenliste (`documents-section.tsx`).
 *
 * Vorher stand beides hier: der Knopf und darunter eine Zeile Verlauf
 * („Zahlungserinnerung am 21.10. · 1. Mahnung vorgesehen ab 04.11."). Die
 * Zeile ist entfallen, nicht gestrichen — sie ist in der Dokumentenliste
 * aufgegangen, wo der Ausblick auf die nächste Stufe als letzte, gestrichelte
 * Zeile steht. Zwei Darstellungen desselben Sachverhalts nebeneinander wären
 * genau die Art Doppelung, die eine Schublade unübersichtlich macht.
 *
 * Auch eine **noch nicht fällige** Rechnung gehört hierher. Eine Erinnerung
 * vor Fälligkeit ist keine Mahnung: Es ist nichts überfällig, es besteht kein
 * Verzug, und es gibt keinen Zinsanspruch. Dass sie trotzdem angeboten wird,
 * kostet nichts — betont wird sie nicht (das macht die Schublade weiterhin nur
 * bei einer überfälligen Rechnung), und der vorbereitete Text in
 * `dunning-drawer.tsx` behauptet in diesem Fall nichts Fälliges.
 *
 * Der Knopf trägt den **Namen der Stufe**, nicht das Wort „Mahnen". Stufe 1
 * ist eine Zahlungserinnerung; sie „Mahnung" zu nennen beschreibt sie falsch
 * und lässt den ersten Klick schwerer wiegen, als er ist.
 *
 * Die Rahmung (Trennlinie, Abstand nach oben) liegt bewusst nicht hier,
 * sondern beim Aktionsbereich der Schublade: Mahnstufe, Versand und Storno
 * stehen dort in **einem** Stapel, und eine eigene Trennlinie mitten darin
 * würde ihn zerschneiden.
 */

interface DunningSectionProps {
  invoice: Invoice
  /** Name des Empfängers, von der Schublade schon aufgelöst. */
  empfaenger: string
  /** Name der eigenen Firma. */
  absender: string
  /**
   * Der Mahnstatus. Die Schublade holt ihn einmal (siehe
   * `use-dunning-status.ts`) und reicht ihn hier wie an die Dokumentenliste
   * weiter — ein Stand für beide, statt zweier Anfragen mit zwei Wahrheiten.
   */
  status: DunningStatus | null
  /** Die Schublade lädt Rechnung und Mahnstatus neu. */
  onChanged: () => void
  /** Die Rechnung ist bezahlt — die Schublade geht zu. */
  onPaid: () => void
  /**
   * Die Mahnstufe ist der wahrscheinliche nächste Schritt und steht im
   * Aktionsbereich ganz oben — dann trägt der Knopf auch das Gewicht dafür.
   * Sonst bleibt er eine Nebenaktion.
   */
  betont?: boolean
}

export default function DunningSection({
  invoice,
  empfaenger,
  absender,
  status,
  onChanged,
  onPaid,
  betont = false,
}: DunningSectionProps) {
  const [schubladeOffen, setSchubladeOffen] = useState(false)

  /**
   * Einmal eingehängt, bleibt eingehängt.
   *
   * Vor dem ersten Klick steht die Schublade nicht im Baum — sie rechnet beim
   * Öffnen auf dem Stand, den die Rechnungsschublade schon geholt hat, und
   * braucht vorher nichts zu tun. Beim Schliessen wird sie aber **nicht**
   * wieder ausgehängt, und das ist der Unterschied zum Dialog von vorher:
   * Wer das Bauteil im selben Augenblick entfernt, in dem es zugeht, nimmt
   * ihm die Bewegung nach rechts hinaus — das Element ist fort, bevor sie
   * beginnt, und die Schublade verschwindet schlagartig statt zu gleiten.
   * Beim Dialog fiel das kaum auf (er blendete aus), bei einer Schublade ist
   * die Bewegung das, woran man sie erkennt.
   *
   * Dass sie eingehängt bleibt, kostet nichts: Alle ihre Effekte steigen bei
   * `!isOpen` sofort aus, und ihr Zustand setzt sich beim Öffnen ohnehin
   * zurück (siehe den Effekt auf `isOpen` in `dunning-drawer.tsx`).
   */
  const [jeGeoeffnet, setJeGeoeffnet] = useState(false)

  /**
   * Das Ziel für den Fokus nach dem Schliessen. Radix kennt den Knopf nicht
   * von selbst — Begründung am `onCloseAutoFocus` in `dunning-drawer.tsx`.
   */
  const knopfRef = useRef<HTMLButtonElement>(null)

  /**
   * Nichts geladen, nicht mahnbar oder keine Stufe mehr übrig: null Pixel.
   *
   * Früher hing der Knopf zusätzlich an `status.istFaellig` — mit der
   * Begründung, ein Knopf, der nur eine Fehlermeldung bringt, sei schlechter
   * als keiner. Diese Begründung trägt nicht: `app/api/invoices/[id]/dunning/route.ts`
   * prüft `istFaellig` an keiner Stelle. Weder `GET` noch `POST` lehnen
   * deshalb ab; `istFaellig` ist eine **Auskunft** über den Zeitplan der
   * Stufen, keine Sperre. Wer früher mahnen will — etwa mit einer
   * freundlichen Erinnerung vor Fälligkeit —, konnte es serverseitig immer,
   * nur kam er hier nicht hin.
   *
   * Die Entscheidung bleibt trotzdem sichtbar: Die Schublade klappt „Anpassen"
   * von selbst auf, wenn die Stufe noch nicht dran ist, und der Serverhinweis
   * sagt, dass vor Verzug weder Zinsen noch Pauschale anfallen.
   */
  if (!status || !status.mahnbar || !status.stufe) return null

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

  return (
    <div>
      {/* Der Hinweis steht über dem Knopf: Wer liest, soll den Zweifel vor dem
          Klick sehen. Volltext samt Ausweg im title — wie bei „Zum
          Fertigstellen fehlt noch: …" im Entwurfseditor. */}
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
        variant={betont ? 'default' : 'outline'}
        className="w-full"
        onClick={() => {
          setJeGeoeffnet(true)
          setSchubladeOffen(true)
        }}
      >
        <BellRing className="mr-2 h-4 w-4" />
        {status.stufe.name}
      </Button>

      {/* Erst bei Bedarf einhängen, dann aber eingehängt lassen — warum,
          steht bei `jeGeoeffnet`. */}
      {jeGeoeffnet && (
        <DunningDrawer
          invoice={invoice}
          empfaenger={empfaenger}
          absender={absender}
          basis={status}
          isOpen={schubladeOffen}
          onClose={() => setSchubladeOffen(false)}
          onCreated={onChanged}
          onPaid={onPaid}
          oeffnerRef={knopfRef}
        />
      )}
    </div>
  )
}
