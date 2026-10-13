import type { ContactInfo, EmailSettings } from '@/types'

/**
 * Weitere Ansprechpartner einer Firma (companies.additional_contacts).
 *
 * Der Ansprechpartner aus den Firmendaten (contact_name/phone/email) bleibt der
 * Standard; eine Rechnung verweist nur dann per contact_person_id auf einen
 * weiteren, wenn er im Editor ausgewählt wurde.
 */
export interface AdditionalContact {
  id: string
  name: string
  phone?: string
  email?: string
}

interface CompanyContactFields {
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  additional_contacts?: unknown
}

export function getAdditionalContacts(company: CompanyContactFields | null | undefined): AdditionalContact[] {
  const list = company?.additional_contacts
  if (!Array.isArray(list)) return []
  return list.filter((c): c is AdditionalContact => !!c && typeof c.id === 'string' && typeof c.name === 'string')
}

/**
 * The contact printed on a self-issued invoice: the chosen additional contact,
 * or the company default when none is chosen (or it was deleted meanwhile).
 */
export function resolveSellerContact(
  company: CompanyContactFields,
  contactPersonId: string | null | undefined
): ContactInfo | undefined {
  const chosen = contactPersonId ? getAdditionalContacts(company).find((c) => c.id === contactPersonId) : undefined
  if (chosen) {
    return { name: chosen.name || undefined, phone: chosen.phone || undefined, email: chosen.email || undefined }
  }
  return company.contact_name || company.contact_phone || company.contact_email
    ? { name: company.contact_name || undefined, phone: company.contact_phone || undefined, email: company.contact_email || undefined }
    : undefined
}

/**
 * Reply-To for the invoice email. An invoice with a chosen additional contact
 * routes replies to that contact; otherwise the company's reply-to setting
 * applies unchanged.
 */
export function resolveReplyTo(
  invoice: { contact_person_id?: string | null; seller_snapshot?: unknown },
  emailSettings: EmailSettings
): string | undefined {
  const contact = (invoice.seller_snapshot as { contact?: ContactInfo } | null)?.contact
  if (invoice.contact_person_id && contact?.email) {
    return contact.name ? `${contact.name} <${contact.email}>` : contact.email
  }
  if (!emailSettings.reply_to_email) return undefined
  return emailSettings.reply_to_name
    ? `${emailSettings.reply_to_name} <${emailSettings.reply_to_email}>`
    : emailSettings.reply_to_email
}
