import type { SupabaseClient } from '@supabase/supabase-js'
import type { DunningStage } from '@/types'

type Db = SupabaseClient

/**
 * Eskalationsstufen des Mahnwesens.
 *
 * Die Tabelle `dunning_stages` ist für die allermeisten Firmen leer. Wer
 * nichts eingestellt hat, bekommt den Standardsatz aus dieser Datei — das
 * erspart eine Migration über den Bestand, hält den Standard an einer Stelle
 * änderbar, und „auf Standard zurücksetzen" ist in der Oberfläche später
 * schlicht ein DELETE.
 *
 * Hier stehen nur die Daten und die Auflösung. Beträge und Fristen werden an
 * anderer Stelle gerechnet.
 */

/**
 * Eine Stufe, wie das Mahnwesen sie braucht — ohne `id`, `company_id` und
 * Zeitstempel, denn die Standardstufen stehen in keiner Zeile.
 */
export type DunningStageDefinition = Pick<
  DunningStage,
  | 'position'
  | 'name'
  | 'days_after_previous'
  | 'grace_days'
  | 'fee_amount'
  | 'charge_interest'
  | 'charge_late_fee_flat'
  | 'intro_text'
  | 'outro_text'
>

/**
 * Der Standardsatz: Zahlungserinnerung, 1. Mahnung, Letzte Mahnung.
 *
 * Drei Stufen statt der üblichen vier, weil § 286 BGB eine einzige Mahnung
 * genügen lässt, um Verzug zu begründen. Alles darüber hinaus ist Kulanz des
 * Gläubigers, kein rechtlicher Zwischenschritt.
 *
 * Zu den Beträgen:
 *
 * `fee_amount` steht überall auf 0. Ersatzfähig sind nach § 286 Abs. 4 BGB nur
 * tatsächlich entstandene Kosten — Porto, Papier, Umschlag —, niemals die
 * eigene Arbeitszeit. Bei einer Mahnung per E-Mail entstehen praktisch keine
 * Kosten; eine pauschale „Mahngebühr 5 €" wäre also nicht durchsetzbar. Wer
 * tatsächlich Briefe verschickt, trägt sein Porto selbst ein.
 *
 * `charge_late_fee_flat` steht auf genau einer Stufe. Die Pauschale von 40 €
 * nach § 288 Abs. 5 BGB fällt einmal je Forderung an, nicht je Schreiben; auf
 * zwei Stufen gesetzt würde sie doppelt berechnet.
 *
 * Die Textbausteine bleiben leer: NULL heißt „Standardtext", und der gehört in
 * die Vorlage, nicht in die Stufenkonfiguration.
 */
export const DEFAULT_DUNNING_STAGES: readonly DunningStageDefinition[] = [
  {
    position: 1,
    name: 'Zahlungserinnerung',
    // Eine Woche Luft nach Fälligkeit. Drei Tage wären zu knapp: Eine
    // Überweisung, die am Fälligkeitstag losgeschickt wurde, ist dann noch
    // unterwegs — besonders über ein Wochenende. Die Software würde also
    // regelmässig Leute erinnern, deren Geld bereits auf dem Weg ist, und das
    // kostet beim allerersten Gebrauch das Vertrauen in die Funktion. Nach
    // einer Woche ist jede normale Überweisung durch, und die Erinnerung wirkt
    // aufmerksam statt ungeduldig.
    days_after_previous: 7,
    grace_days: 7,
    // Vor Verzug ist nichts ersatzfähig — und Verzug begründet überhaupt erst
    // dieses Schreiben. Deshalb weder Gebühr noch Zinsen.
    fee_amount: 0,
    charge_interest: false,
    charge_late_fee_flat: false,
    intro_text: null,
    outro_text: null,
  },
  {
    position: 2,
    name: '1. Mahnung',
    days_after_previous: 7,
    grace_days: 7,
    fee_amount: 0,
    // Ab hier ist der Schuldner in Verzug: Zinsen und Pauschale sind fällig.
    // Die Pauschale genau einmal, deshalb nur auf dieser Stufe.
    charge_interest: true,
    charge_late_fee_flat: true,
    intro_text: null,
    outro_text: null,
  },
  {
    position: 3,
    name: 'Letzte Mahnung',
    days_after_previous: 7,
    grace_days: 7,
    fee_amount: 0,
    charge_interest: true,
    charge_late_fee_flat: false,
    intro_text: null,
    outro_text: null,
  },
]

/**
 * Die Stufen einer Firma: ihre eigenen Zeilen, sonst der Standardsatz.
 *
 * Keine Zeile zu haben ist der Normalfall und kein Fehler — deshalb wird hier
 * nicht zwischen „nichts eingestellt" und „absichtlich keine Stufen"
 * unterschieden. Wer nicht mahnen will, mahnt einfach nicht.
 */
export async function getDunningStages(
  supabase: Db,
  companyId: string
): Promise<DunningStageDefinition[]> {
  const { data, error } = await supabase
    .from('dunning_stages')
    .select(
      'position, name, days_after_previous, grace_days, fee_amount, charge_interest, charge_late_fee_flat, intro_text, outro_text'
    )
    .eq('company_id', companyId)
    .order('position', { ascending: true })

  if (error) throw error
  if (!data || data.length === 0) return [...DEFAULT_DUNNING_STAGES]

  return data as DunningStageDefinition[]
}
