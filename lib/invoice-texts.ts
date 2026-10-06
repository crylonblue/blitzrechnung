import type { InvoiceLanguage } from './invoice-translations'

/**
 * Einleitungs- und Schlusstext je Rechnungssprache.
 *
 * Die Firma pflegt beide Texte getrennt für Deutsch und Englisch. Ohne diese
 * Trennung landete der deutsche Standardtext auch auf englischen Rechnungen.
 */

export const DEFAULT_INVOICE_TEXTS: Record<InvoiceLanguage, { intro: string; outro: string }> = {
  de: {
    intro: 'Vielen Dank für Ihr Vertrauen. Bitte überweisen Sie den Rechnungsbetrag innerhalb der angegebenen Zahlungsfrist.',
    outro: 'Vielen Dank für Ihren Auftrag. Bei Fragen zu dieser Rechnung stehen wir Ihnen gerne zur Verfügung.',
  },
  en: {
    intro: 'Thank you for your business. Please transfer the invoice amount within the stated payment term.',
    outro: 'Thank you for your order. If you have any questions about this invoice, please do not hesitate to contact us.',
  },
}

interface CompanyInvoiceTexts {
  default_intro_text?: string | null
  default_outro_text?: string | null
  default_intro_text_en?: string | null
  default_outro_text_en?: string | null
}

/** Die in den Einstellungen hinterlegten Texte für die gewählte Rechnungssprache. */
export function resolveInvoiceTexts(
  company: CompanyInvoiceTexts,
  language: InvoiceLanguage
): { introText: string | null; outroText: string | null } {
  if (language === 'en') {
    return {
      introText: company.default_intro_text_en || null,
      outroText: company.default_outro_text_en || null,
    }
  }
  return {
    introText: company.default_intro_text || null,
    outroText: company.default_outro_text || null,
  }
}
