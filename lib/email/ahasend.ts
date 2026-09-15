/**
 * AhaSend API client (API v2).
 *
 * Docs: https://ahasend.com/docs/api-reference
 * All endpoints are account-scoped: /v2/accounts/{account_id}/...
 *
 * Unlike the previous Postmark integration there is no per-tenant "server":
 * a registered sending domain is the isolation boundary, so one account-wide
 * API key covers both the default domain and every customer domain.
 */

import type { Attachment, DnsRecord, DomainResult, EmailProvider, SendEmailOptions } from './types'

const API_URL = 'https://api.ahasend.com/v2'

/** Shape of a DNS record as returned by AhaSend. */
interface AhaSendDnsRecord {
  type: string
  host: string
  content: string
  required: boolean
  propagated: boolean
}

/** Subset of the AhaSend domain object we rely on. */
interface AhaSendDomain {
  id: string
  domain: string
  dns_valid: boolean
  dns_records: AhaSendDnsRecord[]
  last_dns_check_at: string | null
}

/** One entry of the create-message response array. */
interface AhaSendMessageResult {
  id: string | null
  status: 'queued' | 'scheduled' | 'error'
  error: string | null
}

interface AhaSendMessageResponse {
  data?: AhaSendMessageResult[]
}

function getApiKey(): string {
  const key = process.env.AHASEND_API_KEY
  if (!key) {
    throw new Error('AHASEND_API_KEY environment variable is not set')
  }
  return key
}

function getAccountId(): string {
  const id = process.env.AHASEND_ACCOUNT_ID
  if (!id) {
    throw new Error('AHASEND_ACCOUNT_ID environment variable is not set')
  }
  return id
}

function accountUrl(path: string): string {
  return `${API_URL}/accounts/${getAccountId()}${path}`
}

/**
 * AhaSend reports errors as { message: string }. Fall back to the status code
 * when the body is empty or not JSON, so callers always get something useful.
 */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json()
    if (body && typeof body.message === 'string') return body.message
  } catch {
    // Not a JSON body - fall through.
  }
  return `${fallback} (HTTP ${response.status})`
}

async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(accountUrl(path), {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new Error(await errorMessage(response, fallback))
  }

  return response.json() as Promise<T>
}

/**
 * Map AhaSend's DNS record shape onto ours.
 *
 * Exported for tests: the field renames (content -> value, propagated ->
 * verified) are easy to get wrong and silently show customers empty records.
 */
export function mapDomain(domain: AhaSendDomain): DomainResult {
  const dns_records: DnsRecord[] = (domain.dns_records || []).map(record => ({
    type: record.type,
    host: record.host,
    value: record.content,
    required: record.required,
    // AhaSend reports `propagated` per record and `dns_valid` for the domain,
    // and the two disagree: we have seen a domain with dns_valid=true whose
    // required DKIM record still said propagated=false, although the record
    // resolved fine in DNS. The aggregate wins, otherwise customers stare at a
    // red cross on a domain that is actually sending. Optional records keep
    // their own state - those really can be missing on a valid domain.
    verified: record.required ? domain.dns_valid || record.propagated : record.propagated,
  }))

  return {
    domain_id: domain.domain,
    verified: domain.dns_valid,
    dns_records,
  }
}

/**
 * Split "Name <mail@example.com>" into the object form AhaSend expects.
 * A bare address is returned without a display name.
 *
 * Exported for tests.
 */
export function parseAddress(address: string): { email: string; name?: string } {
  const match = address.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
  if (match) {
    const name = match[1].replace(/^"(.*)"$/, '$1').trim()
    return name ? { email: match[2].trim(), name } : { email: match[2].trim() }
  }
  return { email: address.trim() }
}

/**
 * Turn the create-message response into an error when AhaSend accepted the
 * request (HTTP 202) but rejected the recipient. Without this check a bounced
 * or suppressed address would be reported to the user as a successful send.
 *
 * Exported for tests.
 */
export function assertMessageAccepted(body: AhaSendMessageResponse): void {
  const results = body.data || []
  if (results.length === 0) {
    throw new Error('AhaSend hat die Nachricht nicht angenommen')
  }
  const failed = results.find(result => result.status === 'error')
  if (failed) {
    throw new Error(failed.error || 'AhaSend hat die Nachricht abgelehnt')
  }
}

function toAhaSendAttachments(attachments: Attachment[] | undefined) {
  return attachments?.map(attachment => ({
    file_name: attachment.name,
    content_type: attachment.contentType,
    data: attachment.content,
    base64: true,
  }))
}

export const ahasend: EmailProvider = {
  async createDomain(domain: string): Promise<DomainResult> {
    const data = await request<AhaSendDomain>(
      '/domains',
      { method: 'POST', body: JSON.stringify({ domain }) },
      'Domain konnte nicht angelegt werden'
    )
    return mapDomain(data)
  },

  async verifyDomain(domain: string): Promise<DomainResult> {
    // Triggers a fresh DNS lookup and returns the updated domain object.
    // AhaSend caches the result for 60 seconds.
    const data = await request<AhaSendDomain>(
      `/domains/${encodeURIComponent(domain)}/check-dns`,
      { method: 'POST' },
      'Domain konnte nicht verifiziert werden'
    )
    return mapDomain(data)
  },

  async deleteDomain(domain: string): Promise<void> {
    const response = await fetch(accountUrl(`/domains/${encodeURIComponent(domain)}`), {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
      },
    })

    // A domain that is already gone is not an error for our callers.
    if (!response.ok && response.status !== 404) {
      throw new Error(await errorMessage(response, 'Domain konnte nicht gelöscht werden'))
    }
  },

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const body = await request<AhaSendMessageResponse>(
      '/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          from: parseAddress(options.from),
          recipients: [parseAddress(options.to)],
          reply_to: options.replyTo ? parseAddress(options.replyTo) : undefined,
          subject: options.subject,
          text_content: options.textBody,
          html_content: options.htmlBody,
          attachments: toAhaSendAttachments(options.attachments),
          // Invoices are not marketing mail: no open pixel, no link rewriting.
          tracking: { open: false, click: false },
        }),
      },
      'E-Mail konnte nicht versendet werden'
    )

    assertMessageAccepted(body)
  },
}
