/**
 * Application configuration
 * 
 * Central place for configurable app settings.
 * Brand name can be customized via NEXT_PUBLIC_APP_NAME environment variable.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'blitzrechnung'

export const config = {
  appName: APP_NAME,
} as const
