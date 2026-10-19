import type { Invoice, InvoiceItem } from './schema'

/**
 * Kleinunternehmerregelung nach § 19 UStG.
 *
 * Wer darunter fällt, weist auf Rechnungen **keine** Umsatzsteuer aus. Das ist
 * keine Steuerbefreiung nach § 4 UStG, sondern ein eigener Tatbestand — und
 * genau das war bisher das Problem: Ohne diesen Modus mussten Betroffene je
 * Position „Steuerfrei · § 4 UStG" wählen und den § 19-Grund von Hand tippen,
 * also die falsche Kategorie mit einem richtigen Text überschreiben.
 *
 * In EN 16931 wird der Fall über die Kategorie `E` (steuerbefreit) mit einer
 * Begründung in BT-120 abgebildet. Die Begründung ist Pflicht: § 14 Abs. 4
 * Nr. 8 UStG verlangt den Hinweis auf die Steuerbefreiung auf der Rechnung
 * selbst.
 */

/** Pflichthinweis auf der Rechnung. */
export const KLEINUNTERNEHMER_HINWEIS =
  'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'

/** Begründung der Steuerbefreiung je Position (BT-120). */
export const KLEINUNTERNEHMER_GRUND = 'Kleinunternehmer gemäß § 19 UStG'

/**
 * Erzwingt die Regelung auf allen Positionen.
 *
 * Bewusst ohne Ausnahme: Ein Kleinunternehmer darf auf *keiner* Position
 * Umsatzsteuer ausweisen. Täte er es doch, schuldete er sie nach § 14c Abs. 2
 * UStG dem Finanzamt, obwohl er sie nie erheben durfte. Eine versehentlich auf
 * 19 % stehende Position wäre also ein teurer Fehler — deshalb wird hier
 * überschrieben statt gewarnt.
 */
export function wendeKleinunternehmerAn(items: InvoiceItem[]): InvoiceItem[] {
  return items.map((item) => ({
    ...item,
    vatRate: 0,
    taxCategory: 'E' as const,
    // Eine bereits gepflegte Begründung bleibt stehen — sie ist vermutlich
    // genauer als der Standardtext.
    exemptionReason: item.exemptionReason?.trim() || KLEINUNTERNEHMER_GRUND,
  }))
}

/**
 * Wendet die Regelung auf eine ganze Rechnung an und hängt den Pflichthinweis
 * an den Schlusstext, falls er dort noch nicht steht.
 */
export function alsKleinunternehmerRechnung(invoice: Invoice): Invoice {
  const hatHinweis = (invoice.outroText ?? '').includes('§ 19')

  return {
    ...invoice,
    taxRate: 0,
    items: wendeKleinunternehmerAn(invoice.items),
    outroText: hatHinweis
      ? invoice.outroText
      : [invoice.outroText?.trim(), KLEINUNTERNEHMER_HINWEIS].filter(Boolean).join('\n\n'),
  }
}
