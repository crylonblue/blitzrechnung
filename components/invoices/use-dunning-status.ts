'use client'

import { useCallback, useEffect, useState } from 'react'
import { ladeMahnstatus, type DunningStatus } from './dunning-api'

/**
 * Der Mahnstatus einer Rechnung, einmal geholt.
 *
 * Er wird inzwischen an **zwei** Stellen gebraucht: in der Dokumentenliste
 * (`documents-section.tsx`) für den Verlauf und den Ausblick, und im
 * Aktionsbereich (`dunning-section.tsx`) für den Knopf. Holte sich jede
 * Stelle ihren eigenen, liefen zwei gleiche Anfragen, und nach einer Änderung
 * stünden kurzzeitig zwei verschiedene Stände nebeneinander. Deshalb liegt der
 * Abruf hier und die Schublade reicht das Ergebnis an beide weiter.
 *
 * `invoiceId === null` heisst „nicht abfragen". Die Schublade nutzt das für
 * Belege, bei denen es nichts zu holen gibt — Entwürfe und Stornorechnungen.
 */
export function useMahnstatus(invoiceId: string | null): {
  status: DunningStatus | null
  /** Nach einer Änderung neu holen (Mahnung angelegt, Entwurf verworfen). */
  neuLaden: () => Promise<void>
} {
  const [status, setStatus] = useState<DunningStatus | null>(null)

  const laden = useCallback(
    async (signal?: AbortSignal) => {
      if (!invoiceId) return
      try {
        const neu = await ladeMahnstatus(invoiceId, {}, signal)
        if (!signal?.aborted) setStatus(neu)
      } catch {
        // Bewusst still. Solange die Route fehlt oder klemmt, zeigt die
        // Schublade einfach kein Mahnwesen — eine Fehlermeldung an dieser
        // Stelle wäre Lärm über eine Funktion, nach der niemand gefragt hat.
        // Die Zeile der Rechnung selbst steht davon unberührt, ihre Dateien
        // hängen nicht am Mahnwesen.
        if (!signal?.aborted) setStatus(null)
      }
    },
    [invoiceId]
  )

  useEffect(() => {
    // Erst leeren, dann holen: Beim Wechsel auf eine andere Rechnung darf für
    // keinen Augenblick der Verlauf der vorherigen stehen bleiben.
    setStatus(null)
    const controller = new AbortController()
    laden(controller.signal)
    return () => controller.abort()
  }, [laden])

  const neuLaden = useCallback(() => laden(), [laden])

  return { status, neuLaden }
}
