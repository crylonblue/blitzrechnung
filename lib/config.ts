/**
 * Application configuration
 * 
 * Central place for configurable app settings.
 * Brand name can be customized via NEXT_PUBLIC_APP_NAME environment variable.
 * Landing page URL can be customized via NEXT_PUBLIC_LANDING_PAGE_URL environment variable.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'blitzrechnung'
export const LANDING_PAGE_URL = process.env.NEXT_PUBLIC_LANDING_PAGE_URL || 'https://blitzrechnung.de'

export const config = {
  appName: APP_NAME,
  landingPageUrl: LANDING_PAGE_URL,
} as const
