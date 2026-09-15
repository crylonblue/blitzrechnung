/**
 * Provider-agnostic email interface.
 *
 * Everything the app does with email goes through this interface so that
 * swapping the provider means writing one new implementation instead of
 * touching the API routes and the invoice service again.
 */

/** A single DNS record the customer has to add at their registrar. */
export interface DnsRecord {
  /** TXT, CNAME, MX, ... */
  type: string
  /** Fully qualified host name of the record. */
  host: string
  /** Expected record value. */
  value: string
  /** Whether the domain can send without this record. */
  required: boolean
  /** Whether the provider currently sees the record in DNS. */
  verified: boolean
}

export interface DomainResult {
  /** Provider-side identifier. For AhaSend this is the domain name itself. */
  domain_id: string
  /** True once every required record is in place. */
  verified: boolean
  dns_records: DnsRecord[]
}

export interface Attachment {
  name: string
  /** Base64-encoded content. */
  content: string
  contentType: string
}

export interface SendEmailOptions {
  from: string
  to: string
  subject: string
  htmlBody?: string
  textBody?: string
  replyTo?: string
  attachments?: Attachment[]
}

export interface EmailProvider {
  /** Register a sending domain and return the DNS records to publish. */
  createDomain(domain: string): Promise<DomainResult>
  /** Re-check DNS for a domain and return the current state. */
  verifyDomain(domain: string): Promise<DomainResult>
  /** Remove a sending domain. */
  deleteDomain(domain: string): Promise<void>
  /** Send a single message. Throws if the provider did not accept it. */
  sendEmail(options: SendEmailOptions): Promise<void>
}
