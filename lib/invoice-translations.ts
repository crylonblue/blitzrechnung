/**
 * Translation utilities for multilanguage invoice support
 * Provides German and English translations for invoice labels
 */

export type InvoiceLanguage = 'de' | 'en'

interface InvoiceTranslations {
  // Invoice document
  invoice: string
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
}

const germanTranslations: InvoiceTranslations = {
  // Invoice document
  invoice: 'RECHNUNG',
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
}

const englishTranslations: InvoiceTranslations = {
  // Invoice document
  invoice: 'INVOICE',
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
