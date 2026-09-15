/**
 * Entry point for all outgoing email.
 *
 * Import from here rather than from a provider module directly, so that
 * changing providers stays a one-line change.
 */

import { DEFAULT_SENDER_EMAIL } from '../config'
import { ahasend } from './ahasend'
import type { EmailProvider } from './types'

export type { Attachment, DnsRecord, DomainResult, EmailProvider, SendEmailOptions } from './types'

export function getEmailProvider(): EmailProvider {
  return ahasend
}

/** Sender address used whenever a company has no verified domain of its own. */
export function getDefaultFromEmail(): string {
  return process.env.AHASEND_DEFAULT_FROM || DEFAULT_SENDER_EMAIL
}

export const createDomain: EmailProvider['createDomain'] = domain =>
  getEmailProvider().createDomain(domain)

export const verifyDomain: EmailProvider['verifyDomain'] = domain =>
  getEmailProvider().verifyDomain(domain)

export const deleteDomain: EmailProvider['deleteDomain'] = domain =>
  getEmailProvider().deleteDomain(domain)

export const sendEmail: EmailProvider['sendEmail'] = options =>
  getEmailProvider().sendEmail(options)
