/**
 * Translation utilities for multilanguage invoice support
 * Provides German and English translations for invoice labels
 */

export type InvoiceLanguage = 'de' | 'en'

interface InvoiceTranslations {
  // Invoice document
  invoice: string
  cancellationInvoice: string
  originalInvoiceRef: (invoiceNumber: string) => string
  invoiceNumber: string
  invoiceDate: string
  serviceDate: string
  dueDate: string
  
  // Table headers
  description: string
  quantity: string
  unit: string
  unitPrice: string
  price: string
  total: string
  
  // Totals
  subtotal: string
  netAmount: string
  vatLabel: string // "MwSt." or "VAT"
  vat: (rate: number) => string // "MwSt. (19%)" or "VAT (19%)"
  grossAmount: string
  totalAmount: string
  
  // Bank details
  bankDetails: string
  bankName: string
  iban: string
  bic: string
  accountHolder: string
  
  // Contact info
  phone: string
  taxNumber: string
  vatId: string
  
  // Email templates
  emailSubject: (invoiceNumber: string) => string
  emailGreeting: string
  emailBody: (invoiceNumber: string, totalAmount: string) => string
  emailClosing: string
  emailQuestionsAvailable: string
  
  // Cancellation email templates
  cancellationEmailSubject: (invoiceNumber: string) => string
  cancellationEmailBody: (cancellationNumber: string, originalInvoiceNumber: string) => string
  cancellationIntroText: (originalInvoiceNumber: string, originalInvoiceDate: string) => string
}

const germanTranslations: InvoiceTranslations = {
  // Invoice document
  invoice: 'RECHNUNG',
  cancellationInvoice: 'STORNORECHNUNG',
  originalInvoiceRef: (invoiceNumber: string) => `Storno zu Rechnung ${invoiceNumber}`,
  invoiceNumber: 'Rechnungsnummer',
  invoiceDate: 'Rechnungsdatum',
  serviceDate: 'Leistungsdatum',
  dueDate: 'Fälligkeitsdatum',
  
  // Table headers
  description: 'Beschreibung',
  quantity: 'Menge',
  unit: 'Einheit',
  unitPrice: 'Preis',
  price: 'Preis',
  total: 'Gesamt',
  
  // Totals
  subtotal: 'Zwischensumme',
  netAmount: 'Nettobetrag',
  vatLabel: 'MwSt.',
  vat: (rate: number) => `MwSt. (${rate}%)`,
  grossAmount: 'Gesamtbetrag',
  totalAmount: 'Gesamtbetrag',
  
  // Bank details
  bankDetails: 'Bankverbindung',
  bankName: 'Bank',
  iban: 'IBAN',
  bic: 'BIC / SWIFT',
  accountHolder: 'Kontoinhaber',
  
  // Contact info
  phone: 'Tel.',
  taxNumber: 'Steuernummer',
  vatId: 'USt-IdNr.',
  
  // Email templates
  emailSubject: (invoiceNumber: string) => `Rechnung ${invoiceNumber}`,
  emailGreeting: 'Sehr geehrte Damen und Herren,',
  emailBody: (invoiceNumber: string, totalAmount: string) => 
    `anbei erhalten Sie Rechnung ${invoiceNumber} über ${totalAmount}.`,
  emailClosing: 'Mit freundlichen Grüßen',
  emailQuestionsAvailable: 'Bei Fragen stehen wir Ihnen gerne zur Verfügung.',
  
  // Cancellation email templates
  cancellationEmailSubject: (invoiceNumber: string) => `Stornorechnung ${invoiceNumber}`,
  cancellationEmailBody: (cancellationNumber: string, originalInvoiceNumber: string) => 
    `anbei erhalten Sie die Stornorechnung ${cancellationNumber} zur Stornierung der Rechnung ${originalInvoiceNumber}.`,
  cancellationIntroText: (originalInvoiceNumber: string, originalInvoiceDate: string) =>
    `hiermit stornieren wir unsere Rechnung ${originalInvoiceNumber} vom ${originalInvoiceDate} in voller Höhe.`,
}

const englishTranslations: InvoiceTranslations = {
  // Invoice document
  invoice: 'INVOICE',
  cancellationInvoice: 'CANCELLATION INVOICE',
  originalInvoiceRef: (invoiceNumber: string) => `Cancellation of invoice ${invoiceNumber}`,
  invoiceNumber: 'Invoice Number',
  invoiceDate: 'Invoice Date',
  serviceDate: 'Service Date',
  dueDate: 'Due Date',
  
  // Table headers
  description: 'Description',
  quantity: 'Quantity',
  unit: 'Unit',
  unitPrice: 'Price',
  price: 'Price',
  total: 'Total',
  
  // Totals
  subtotal: 'Subtotal',
  netAmount: 'Net Amount',
  vatLabel: 'VAT',
  vat: (rate: number) => `VAT (${rate}%)`,
  grossAmount: 'Total Amount',
  totalAmount: 'Total Amount',
  
  // Bank details
  bankDetails: 'Bank Details',
  bankName: 'Bank',
  iban: 'IBAN',
  bic: 'BIC / SWIFT',
  accountHolder: 'Account Holder',
  
  // Contact info
  phone: 'Phone',
  taxNumber: 'Tax Number',
  vatId: 'VAT ID',
  
  // Email templates
  emailSubject: (invoiceNumber: string) => `Invoice ${invoiceNumber}`,
  emailGreeting: 'Dear Sir or Madam,',
  emailBody: (invoiceNumber: string, totalAmount: string) => 
    `please find attached invoice ${invoiceNumber} for ${totalAmount}.`,
  emailClosing: 'Best regards',
  emailQuestionsAvailable: 'If you have any questions, please feel free to contact us.',
  
  // Cancellation email templates
  cancellationEmailSubject: (invoiceNumber: string) => `Cancellation Invoice ${invoiceNumber}`,
  cancellationEmailBody: (cancellationNumber: string, originalInvoiceNumber: string) => 
    `please find attached the cancellation invoice ${cancellationNumber} for the cancellation of invoice ${originalInvoiceNumber}.`,
  cancellationIntroText: (originalInvoiceNumber: string, originalInvoiceDate: string) =>
    `We hereby cancel our invoice ${originalInvoiceNumber} dated ${originalInvoiceDate} in full.`,
}

/**
 * Get translations for a specific language
 */
export function getTranslations(language: InvoiceLanguage): InvoiceTranslations {
  return language === 'en' ? englishTranslations : germanTranslations
}

/**
 * Format date according to language locale
 */
export function formatDateForLanguage(dateString: string, language: InvoiceLanguage): string {
  const [year, month, day] = dateString.split('-')
  
  if (language === 'en') {
    // English format: MM/DD/YYYY
    return `${month}/${day}/${year}`
  } else {
    // German format: DD.MM.YYYY
    return `${day}.${month}.${year}`
  }
}

/**
 * Format currency according to language locale
 */
export function formatCurrencyForLanguage(amount: number, language: InvoiceLanguage): string {
  if (language === 'en') {
    // English format: €1,234.56
    return '€' + amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } else {
    // German format: 1.234,56 €
    return amount.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' €'
  }
}

/**
 * Get default email subject template for language
 */
export function getDefaultEmailSubject(language: InvoiceLanguage): string {
  const t = getTranslations(language)
  return t.emailSubject('{invoice_number}')
}

/**
 * Get default email body template for language
 */
export function getDefaultEmailBody(language: InvoiceLanguage): string {
  const t = getTranslations(language)
  return `${t.emailGreeting}

${t.emailBody('{invoice_number}', '{total_amount}')}

${t.emailQuestionsAvailable}

${t.emailClosing}`
}

/**
 * Default email subject for a cancellation invoice (Stornorechnung).
 * Kein Platzhalter für die Originalnummer — die kennt nur der Aufrufer.
 */
export function getDefaultCancellationEmailSubject(language: InvoiceLanguage): string {
  return getTranslations(language).cancellationEmailSubject('{invoice_number}')
}

/**
 * Default email body for a cancellation invoice. Ohne eigene Vorlage: Die
 * Rechnungsvorlage der Firma kündigt „Rechnung … über {total_amount}" an und
 * machte aus dem Storno eine Rechnung über einen negativen Betrag.
 */
export function getDefaultCancellationEmailBody(language: InvoiceLanguage, originalInvoiceNumber: string): string {
  const t = getTranslations(language)
  return `${t.emailGreeting}

${t.cancellationEmailBody('{invoice_number}', originalInvoiceNumber)}

${t.emailQuestionsAvailable}

${t.emailClosing}`
}
