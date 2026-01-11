import type { Invoice, PartySnapshot } from '@/types'

/**
 * Default email subject template
 */
export const DEFAULT_INVOICE_EMAIL_SUBJECT = 'Rechnung {invoice_number}'

/**
 * Default email body template
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
 * Formats a number as German currency
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

/**
 * Formats a date string as German date
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString)
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
  buyer: PartySnapshot | null
): string {
  return template
    .replace(/{invoice_number}/g, invoice.invoice_number || '')
    .replace(/{customer_name}/g, buyer?.name || '')
    .replace(/{total_amount}/g, formatCurrency(invoice.total_amount))
    .replace(/{invoice_date}/g, formatDate(invoice.invoice_date))
}

/**
 * Generates a complete email subject with placeholders replaced
 */
export function generateEmailSubject(
  template: string | undefined,
  invoice: Invoice,
  buyer: PartySnapshot | null
): string {
  const subjectTemplate = template || DEFAULT_INVOICE_EMAIL_SUBJECT
  return replaceEmailPlaceholders(subjectTemplate, invoice, buyer)
}

/**
 * Generates a complete email body with placeholders replaced
 */
export function generateEmailBody(
  template: string | undefined,
  invoice: Invoice,
  buyer: PartySnapshot | null
): string {
  const bodyTemplate = template || DEFAULT_INVOICE_EMAIL_BODY
  return replaceEmailPlaceholders(bodyTemplate, invoice, buyer)
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
