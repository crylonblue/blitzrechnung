/**
 * Application configuration
 * 
 * Central place for configurable app settings.
 * Brand name can be customized via NEXT_PUBLIC_APP_NAME environment variable.
 * Landing page URL can be customized via NEXT_PUBLIC_LANDING_PAGE_URL environment variable.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'blitzrechnung'
export const LANDING_PAGE_URL = process.env.NEXT_PUBLIC_LANDING_PAGE_URL || 'https://blitzrechnung.de'

/**
 * Shared sender for every company without a verified domain of its own.
 * Also referenced in the settings UI, so it lives here rather than behind a
 * server-only environment variable.
 */
export const DEFAULT_SENDER_EMAIL = 'rechnung@email.blitzrechnung.de'

/** Where customers ask for their own sender domain to be set up. */
export const CUSTOM_DOMAIN_CONTACT_EMAIL = 'hello@till.email'

export const config = {
  appName: APP_NAME,
  landingPageUrl: LANDING_PAGE_URL,
  defaultSenderEmail: DEFAULT_SENDER_EMAIL,
  customDomainContactEmail: CUSTOM_DOMAIN_CONTACT_EMAIL,
} as const
