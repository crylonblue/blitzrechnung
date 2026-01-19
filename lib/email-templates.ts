import type { Invoice, PartySnapshot } from '@/types'
import { getDefaultEmailSubject, getDefaultEmailBody, type InvoiceLanguage } from './invoice-translations'

/**
 * Default email subject template (German)
 */
export const DEFAULT_INVOICE_EMAIL_SUBJECT = 'Rechnung {invoice_number}'

/**
 * Default email body template (German)
 */
export const DEFAULT_INVOICE_EMAIL_BODY = `Sehr geehrte Damen und Herren,

anbei erhalten Sie Rechnung {invoice_number} über {total_amount}.

Bei Fragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen`

/**
 * Available placeholders for email templates
 */
export const EMAIL_PLACEHOLDERS = [
  { placeholder: '{invoice_number}', description: 'Rechnungsnummer' },
  { placeholder: '{customer_name}', description: 'Kundenname' },
  { placeholder: '{total_amount}', description: 'Gesamtbetrag' },
  { placeholder: '{invoice_date}', description: 'Rechnungsdatum' },
] as const

/**
 * Formats a number as currency according to language
 */
function formatCurrency(amount: number, language: InvoiceLanguage = 'de'): string {
  if (language === 'en') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount)
  }
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

/**
 * Formats a date string according to language
 */
function formatDate(dateString: string | null, language: InvoiceLanguage = 'de'): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (language === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).format(date)
  }
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/**
 * Replaces placeholders in a template string with actual values
 */
export function replaceEmailPlaceholders(
  template: string,
  invoice: Invoice,
  buyer: PartySnapshot | null,
  language: InvoiceLanguage = 'de'
): string {
  return template
    .replace(/{invoice_number}/g, invoice.invoice_number || '')
    .replace(/{customer_name}/g, buyer?.name || '')
    .replace(/{total_amount}/g, formatCurrency(invoice.total_amount, language))
    .replace(/{invoice_date}/g, formatDate(invoice.invoice_date, language))
}

/**
 * Generates a complete email subject with placeholders replaced
 */
export function generateEmailSubject(
  template: string | undefined,
  invoice: Invoice,
  buyer: PartySnapshot | null,
  language: InvoiceLanguage = 'de'
): string {
  // Use template if provided, otherwise use language-specific default
  const subjectTemplate = template || getDefaultEmailSubject(language)
  return replaceEmailPlaceholders(subjectTemplate, invoice, buyer, language)
}

/**
 * Generates a complete email body with placeholders replaced
 */
export function generateEmailBody(
  template: string | undefined,
  invoice: Invoice,
  buyer: PartySnapshot | null,
  language: InvoiceLanguage = 'de'
): string {
  // Use template if provided, otherwise use language-specific default
  const bodyTemplate = template || getDefaultEmailBody(language)
  return replaceEmailPlaceholders(bodyTemplate, invoice, buyer, language)
}

/**
 * Converts plain text to simple HTML for email
 */
export function textToHtml(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim() === '' ? '<br>' : `<p>${escapeHtml(line)}</p>`)
    .join('\n')
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
