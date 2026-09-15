/**
 * Spalten, die die Listenansichten tatsächlich brauchen.
 *
 * Vorher luden die Listen `select('*')` — inklusive `line_items` und
 * `seller_snapshot`, die in keiner Listenkomponente vorkommen. Diese Felder
 * wurden geladen, an die Client-Komponenten gereicht und dadurch doppelt
 * serialisiert (einmal ins HTML, einmal in die Hydration-Payload), ohne je
 * angezeigt zu werden.
 *
 * Bei den heutigen Datenmengen ist das kaum messbar. Der Punkt ist die Kurve:
 * Die Liste wächst mit jeder Rechnung, die ein Kunde schreibt — die App würde
 * ausgerechnet für den umsatzstärksten Kunden langsam.
 *
 * Die Listen sind nicht die einzigen Verbraucher: Zeilen wandern weiter in den
 * Drawer und das Versand-Modal. Die Felder unten sind deshalb die *Vereinigung*
 * aus allem, was von der Liste aus erreichbar ist. Wer hier etwas streicht,
 * prüft vorher components/invoices/invoice-drawer.tsx und send-invoice-modal.tsx.
 */

/**
 * Tabelle + Filterleiste + Drawer + Versand-Modal + Statuswechsel.
 * Bewusst draußen: line_items, seller_snapshot (die beiden großen JSONB-Felder).
 */
export const INVOICE_LIST_COLUMNS =
  'id, company_id, invoice_number, invoice_type, invoice_date, due_date, status, ' +
  'total_amount, buyer_is_self, buyer_snapshot, recipient_email, ' +
  'pdf_url, xml_url, invoice_file_reference, created_at'

/** Entwurfsliste — zeigt nur Datum, Kunde und Summe. */
export const DRAFT_LIST_COLUMNS =
  'id, company_id, status, created_at, total_amount, buyer_is_self, buyer_snapshot'

/*
 * Kontakte bleiben bewusst bei select('*'): Der Bearbeiten-Drawer öffnet direkt
 * aus der Tabelle und braucht Bankverbindung, Registerangaben und die zerlegte
 * Adresse — also praktisch jede Spalte. Eine Liste hier wäre reines Risiko ohne
 * Gewinn, weil die Kontaktzeilen keine großen JSONB-Felder enthalten.
 */
