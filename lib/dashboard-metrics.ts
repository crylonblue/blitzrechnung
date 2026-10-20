import type { Invoice } from '@/types'

/**
 * Nur die Felder, die die Kennzahlen der Übersicht brauchen. Die Berechnung
 * liegt hier statt in der Server Component, damit sie ohne Datenbank und ohne
 * React testbar ist.
 */
export type MetricsInvoice = Pick<
  Invoice,
  | 'id'
  | 'status'
  | 'invoice_type'
  | 'invoice_date'
  | 'due_date'
  | 'total_amount'
  | 'subtotal'
  | 'cancelled_invoice_id'
>

export interface DashboardMetrics {
  /** Brutto, was Kunden noch schulden (fakturiert, nicht bezahlt). */
  openAmount: number
  /** Davon der Teil, dessen Fälligkeit überschritten ist. */
  overdueAmount: number
  overdueCount: number
  /** Netto fakturierter Umsatz des laufenden Jahres. */
  revenueYearNet: number
  /** Das Jahr, auf das sich `revenueYearNet` bezieht. */
  year: number
}

const UNPAID = new Set(['created', 'sent', 'reminded'])

/**
 * invoice_date/due_date sind reine Datumsspalten (YYYY-MM-DD). `new Date()`
 * liest sie als UTC-Mitternacht — westlich von Greenwich fiele der 1. Januar
 * damit ins Vorjahr. Das Jahr kommt deshalb direkt aus dem String.
 */
function jahrVon(datum: string): number {
  return Number(datum.slice(0, 4))
}

export function computeDashboardMetrics(
  invoices: MetricsInvoice[],
  now: Date = new Date()
): DashboardMetrics {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const year = startOfToday.getFullYear()

  // Welche Ursprungsrechnungen haben einen echten Storno-Beleg? Das Stornieren
  // über den Rechnungs-Flow legt einen an; der Status 'cancelled' lässt sich
  // über die v1-API aber auch ohne Beleg setzen. Beide Fälle müssen beim
  // Umsatz unterschiedlich zählen (siehe unten).
  const mitStornobeleg = new Set<string>()
  for (const inv of invoices) {
    if (inv.invoice_type === 'cancellation' && inv.cancelled_invoice_id) {
      mitStornobeleg.add(inv.cancelled_invoice_id)
    }
  }

  let openAmount = 0
  let overdueAmount = 0
  let overdueCount = 0
  let revenueYearNet = 0

  for (const inv of invoices) {
    const istStorno = inv.invoice_type === 'cancellation'
    const gross = inv.total_amount || 0

    // Ein Storno-Beleg ist eine Gutschrift, keine Forderung: Er trägt zwar den
    // Status 'created' und das Fälligkeitsdatum der Ursprungsrechnung, aber
    // niemand schuldet daraus etwas. Ohne diese Ausnahme landete sein negativer
    // Betrag in „Offen" und — bei vergangener Fälligkeit — in „Überfällig",
    // samt mitgezählter überfälliger Rechnung.
    if (!istStorno && UNPAID.has(inv.status)) {
      openAmount += gross
      if (inv.due_date) {
        const due = new Date(inv.due_date)
        due.setHours(0, 0, 0, 0)
        if (due < startOfToday) {
          overdueAmount += gross
          overdueCount += 1
        }
      }
    }

    // Umsatz des Jahres: Ursprungsrechnung und Storno-Beleg zählen beide mit und
    // heben sich gegenseitig auf — statt beide auszublenden. Grund: Der Storno
    // trägt sein eigenes Datum. Wird eine Rechnung aus 2025 erst 2026 storniert,
    // bleibt der Umsatz 2025 stehen und die Minderung fällt ins Jahr 2026. So
    // ändert eine Stornierung keine abgeschlossene Periode rückwirkend, und die
    // Kachel stimmt mit dem DATEV-Buchungsstapel überein, der die Gegenbuchung
    // ebenfalls zum Datum des Storno-Belegs schreibt.
    //
    // Ausnahme: Steht eine Rechnung auf 'cancelled', ohne dass ein Storno-Beleg
    // existiert (per API gesetzter Status), fehlt die Gegenbuchung — dann muss
    // sie selbst herausfallen.
    const zaehltZumUmsatz = inv.status !== 'cancelled' || mitStornobeleg.has(inv.id)
    if (zaehltZumUmsatz && inv.invoice_date && jahrVon(inv.invoice_date) === year) {
      revenueYearNet += inv.subtotal || 0
    }
  }

  return { openAmount, overdueAmount, overdueCount, revenueYearNet, year }
}
