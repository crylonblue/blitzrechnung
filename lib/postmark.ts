/**
 * Postmark API Client
 * 
 * Handles email sending and domain verification for custom sender domains.
 * Documentation: https://postmarkapp.com/developer
 * 
 * We use the Domains API for domain-level verification (DKIM, Return-Path)
 * which is required for proper email authentication.
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com'

/**
 * Response from Postmark Domains API
 * See: https://postmarkapp.com/developer/api/domains-api
 */
interface PostmarkDomainResponse {
  ID: number
  Name: string
  SPFVerified: boolean
  DKIMVerified: boolean
  WeakDKIM: boolean
  ReturnPathDomainVerified: boolean
  // DKIM DNS record info
  DKIMHost: string
  DKIMTextValue: string
  DKIMPendingHost: string
  DKIMPendingTextValue: string
  DKIMRevokedHost: string
  DKIMRevokedTextValue: string
  DKIMUpdateStatus: string
  // Return-Path DNS record info
  ReturnPathDomain: string
  ReturnPathDomainCNAMEValue: string
}

export interface DomainDnsRecords {
  dkim: { type: string; host: string; value: string; verified?: boolean }
  return_path: { type: string; host: string; value: string; verified?: boolean }
}

export interface DomainVerificationResult {
  verified: boolean
  dkim_verified: boolean
  return_path_verified: boolean
  dns_records: DomainDnsRecords
}

export interface CreateDomainResult {
  postmark_domain_id: number
  dns_records: DomainDnsRecords
}

/**
 * Response from Postmark Servers API
 * See: https://postmarkapp.com/developer/api/servers-api
 */
interface PostmarkServerResponse {
  ID: number
  Name: string
  ApiTokens: string[]
  Color: string
  SmtpApiActivated: boolean
  RawEmailEnabled: boolean
  DeliveryType: string
  ServerLink: string
  InboundAddress: string
  InboundHookUrl: string
  BounceHookUrl: string
  OpenHookUrl: string
  DeliveryHookUrl: string
  PostFirstOpenOnly: boolean
  InboundDomain: string
  InboundHash: string
  InboundSpamThreshold: number
  TrackOpens: boolean
  TrackLinks: string
  IncludeBounceContentInHook: boolean
  ClickHookUrl: string
  EnableSmtpApiErrorHooks: boolean
}

export interface CreateServerResult {
  postmark_server_id: number
  postmark_server_token: string
}

function getServerToken(): string {
  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    throw new Error('POSTMARK_SERVER_TOKEN environment variable is not set')
  }
  return token
}

function getAccountToken(): string {
  const token = process.env.POSTMARK_ACCOUNT_TOKEN
  if (!token) {
    throw new Error('POSTMARK_ACCOUNT_TOKEN environment variable is not set')
  }
  return token
}

/**
 * Add a domain to Postmark for email sending
 * This creates the domain in Postmark and returns the DNS records needed for verification
 * See: https://postmarkapp.com/developer/api/domains-api#create-domain
 */
export async function createDomain(domain: string): Promise<CreateDomainResult> {
  const response = await fetch(`${POSTMARK_API_URL}/domains`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Account-Token': getAccountToken(),
    },
    body: JSON.stringify({
      Name: domain,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to create domain')
  }

  const data: PostmarkDomainResponse = await response.json()

  return {
    postmark_domain_id: data.ID,
    dns_records: {
      dkim: {
        type: 'TXT',
        host: data.DKIMPendingHost || data.DKIMHost,
        value: data.DKIMPendingTextValue || data.DKIMTextValue,
        verified: data.DKIMVerified,
      },
      return_path: {
        type: 'CNAME',
        host: data.ReturnPathDomain,
        value: data.ReturnPathDomainCNAMEValue,
        verified: data.ReturnPathDomainVerified,
      },
    },
  }
}

/**
 * Verify a domain's DNS records in Postmark
 * This triggers verification of DKIM and Return-Path records
 * See: https://postmarkapp.com/developer/api/domains-api#verify-dkim
 */
export async function verifyDomain(
  postmarkDomainId: number
): Promise<DomainVerificationResult> {
  // Verify DKIM
  await fetch(
    `${POSTMARK_API_URL}/domains/${postmarkDomainId}/verifyDkim`,
    {
      method: 'PUT',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Account-Token': getAccountToken(),
      },
    }
  )

  // Verify Return-Path
  await fetch(
    `${POSTMARK_API_URL}/domains/${postmarkDomainId}/verifyReturnPath`,
    {
      method: 'PUT',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Account-Token': getAccountToken(),
      },
    }
  )

  // Get the current status
  const response = await fetch(
    `${POSTMARK_API_URL}/domains/${postmarkDomainId}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Postmark-Account-Token': getAccountToken(),
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to verify domain')
  }

  const data: PostmarkDomainResponse = await response.json()

  return {
    verified: data.DKIMVerified && data.ReturnPathDomainVerified,
    dkim_verified: data.DKIMVerified,
    return_path_verified: data.ReturnPathDomainVerified,
    dns_records: {
      dkim: {
        type: 'TXT',
        host: data.DKIMPendingHost || data.DKIMHost,
        value: data.DKIMPendingTextValue || data.DKIMTextValue,
        verified: data.DKIMVerified,
      },
      return_path: {
        type: 'CNAME',
        host: data.ReturnPathDomain,
        value: data.ReturnPathDomainCNAMEValue,
        verified: data.ReturnPathDomainVerified,
      },
    },
  }
}

/**
 * Delete a domain from Postmark
 * See: https://postmarkapp.com/developer/api/domains-api#delete-domain
 */
export async function deleteDomain(postmarkDomainId: number): Promise<void> {
  const response = await fetch(
    `${POSTMARK_API_URL}/domains/${postmarkDomainId}`,
    {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'X-Postmark-Account-Token': getAccountToken(),
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to delete domain')
  }
}

/**
 * Create a new Postmark server for a user's custom domain
 * Each user with a custom domain gets their own dedicated server for isolation
 * See: https://postmarkapp.com/developer/api/servers-api#create-server
 */
export async function createServer(name: string): Promise<CreateServerResult> {
  const response = await fetch(`${POSTMARK_API_URL}/servers`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Account-Token': getAccountToken(),
    },
    body: JSON.stringify({
      Name: name,
      Color: 'blue',
      TrackOpens: true,
      TrackLinks: 'HtmlAndText',
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to create server')
  }

  const data: PostmarkServerResponse = await response.json()

  return {
    postmark_server_id: data.ID,
    postmark_server_token: data.ApiTokens[0],
  }
}

/**
 * Delete a Postmark server
 * See: https://postmarkapp.com/developer/api/servers-api#delete-server
 */
export async function deleteServer(serverId: number): Promise<void> {
  const response = await fetch(
    `${POSTMARK_API_URL}/servers/${serverId}`,
    {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'X-Postmark-Account-Token': getAccountToken(),
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to delete server')
  }
}

/**
 * Get the default sender email address
 */
export function getDefaultFromEmail(): string {
  return process.env.POSTMARK_DEFAULT_FROM || 'rechnung@blitzrechnung.de'
}

/**
 * Send an email via Postmark
 * If serverToken is provided, uses that (for custom domain servers)
 * Otherwise falls back to the default POSTMARK_SERVER_TOKEN env variable
 */
export async function sendEmail(options: {
  from: string
  to: string
  subject: string
  htmlBody?: string
  textBody?: string
  replyTo?: string
  attachments?: Array<{
    name: string
    content: string // Base64 encoded
    contentType: string
  }>
  serverToken?: string
}): Promise<void> {
  const token = options.serverToken || getServerToken()
  
  const response = await fetch(`${POSTMARK_API_URL}/email`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: options.from,
      To: options.to,
      Subject: options.subject,
      HtmlBody: options.htmlBody,
      TextBody: options.textBody,
      ReplyTo: options.replyTo,
      Attachments: options.attachments?.map(a => ({
        Name: a.name,
        Content: a.content,
        ContentType: a.contentType,
      })),
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.Message || 'Failed to send email')
  }
}
