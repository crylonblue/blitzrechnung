import type { LineItem, PartySnapshot, Address, Company } from '@/types'

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

/**
 * Validates all required fields for a legally compliant German invoice (§14 UStG)
 */
export function validateInvoiceForFinalization(params: {
  company: Company | null
  issuerSnapshot: PartySnapshot | null
  customerSnapshot: PartySnapshot | null
  lineItems: LineItem[]
  invoiceDate: string | null
  useDefaultIssuer: boolean
}): ValidationResult {
  const errors: ValidationError[] = []
  const { company, issuerSnapshot, customerSnapshot, lineItems, invoiceDate, useDefaultIssuer } = params

  // ============================================
  // ISSUER VALIDATION (Rechnungssteller)
  // ============================================
  
  if (useDefaultIssuer) {
    // Validate company data
    if (!company) {
      errors.push({
        field: 'issuer',
        message: 'Firmendaten konnten nicht geladen werden.',
      })
    } else {
      // Company name
      if (!company.name?.trim()) {
        errors.push({
          field: 'issuer.name',
          message: 'Firmenname fehlt. Bitte in den Einstellungen hinterlegen.',
        })
      }

      // Company address
      const companyAddress = company.address as Address | null
      if (!companyAddress) {
        errors.push({
          field: 'issuer.address',
          message: 'Firmenadresse fehlt. Bitte in den Einstellungen hinterlegen.',
        })
      } else {
        if (!companyAddress.street?.trim()) {
          errors.push({
            field: 'issuer.address.street',
            message: 'Straße der Firma fehlt.',
          })
        }
        if (!companyAddress.streetnumber?.trim()) {
          errors.push({
            field: 'issuer.address.streetnumber',
            message: 'Hausnummer der Firma fehlt.',
          })
        }
        if (!companyAddress.zip?.trim()) {
          errors.push({
            field: 'issuer.address.zip',
            message: 'PLZ der Firma fehlt.',
          })
        }
        if (!companyAddress.city?.trim()) {
          errors.push({
            field: 'issuer.address.city',
            message: 'Stadt der Firma fehlt.',
          })
        }
        if (!companyAddress.country?.trim()) {
          errors.push({
            field: 'issuer.address.country',
            message: 'Land der Firma fehlt.',
          })
        }
      }

      // Tax identification - at least one required by §14 UStG
      if (!company.tax_id?.trim() && !company.vat_id?.trim()) {
        errors.push({
          field: 'issuer.tax',
          message: 'Steuernummer oder USt-IdNr. fehlt. Mindestens eine Angabe ist nach §14 UStG erforderlich.',
        })
      }

      // Bank details - practically required for payment
      const bankDetails = company.bank_details as { iban?: string; bank_name?: string } | null
      if (!bankDetails?.iban?.trim()) {
        errors.push({
          field: 'issuer.bank',
          message: 'IBAN fehlt. Bitte Bankdaten in den Einstellungen hinterlegen.',
        })
      }

      // Note: Seller Contact (XRechnung BR-DE-2) is optional
    }
  } else {
    // Validate custom issuer snapshot
    if (!issuerSnapshot) {
      errors.push({
        field: 'issuer',
        message: 'Kein Absender ausgewählt.',
      })
    } else {
      if (!issuerSnapshot.name?.trim()) {
        errors.push({
          field: 'issuer.name',
          message: 'Name des Absenders fehlt.',
        })
      }

      if (!issuerSnapshot.address) {
        errors.push({
          field: 'issuer.address',
          message: 'Adresse des Absenders fehlt.',
        })
      } else {
        if (!issuerSnapshot.address.street?.trim()) {
          errors.push({
            field: 'issuer.address.street',
            message: 'Straße des Absenders fehlt.',
          })
        }
        if (!issuerSnapshot.address.streetnumber?.trim()) {
          errors.push({
            field: 'issuer.address.streetnumber',
            message: 'Hausnummer des Absenders fehlt.',
          })
        }
        if (!issuerSnapshot.address.zip?.trim()) {
          errors.push({
            field: 'issuer.address.zip',
            message: 'PLZ des Absenders fehlt.',
          })
        }
        if (!issuerSnapshot.address.city?.trim()) {
          errors.push({
            field: 'issuer.address.city',
            message: 'Stadt des Absenders fehlt.',
          })
        }
        if (!issuerSnapshot.address.country?.trim()) {
          errors.push({
            field: 'issuer.address.country',
            message: 'Land des Absenders fehlt.',
          })
        }
      }

      // Tax identification
      if (!issuerSnapshot.tax_id?.trim() && !issuerSnapshot.vat_id?.trim()) {
        errors.push({
          field: 'issuer.tax',
          message: 'Steuernummer oder USt-IdNr. des Absenders fehlt.',
        })
      }

      // Bank details
      if (!issuerSnapshot.bank_details?.iban?.trim()) {
        errors.push({
          field: 'issuer.bank',
          message: 'IBAN des Absenders fehlt.',
        })
      }

      // Note: Seller Contact (XRechnung BR-DE-2) is optional
    }
  }

  // ============================================
  // CUSTOMER VALIDATION (Rechnungsempfänger)
  // ============================================
  
  if (!customerSnapshot) {
    errors.push({
      field: 'customer',
      message: 'Bitte wählen Sie einen Empfänger aus.',
    })
  } else {
    if (!customerSnapshot.name?.trim()) {
      errors.push({
        field: 'customer.name',
        message: 'Name des Empfängers fehlt.',
      })
    }

    if (!customerSnapshot.address) {
      errors.push({
        field: 'customer.address',
        message: 'Adresse des Empfängers fehlt.',
      })
    } else {
      if (!customerSnapshot.address.street?.trim()) {
        errors.push({
          field: 'customer.address.street',
          message: 'Straße des Empfängers fehlt.',
        })
      }
      if (!customerSnapshot.address.streetnumber?.trim()) {
        errors.push({
          field: 'customer.address.streetnumber',
          message: 'Hausnummer des Empfängers fehlt.',
        })
      }
      if (!customerSnapshot.address.zip?.trim()) {
        errors.push({
          field: 'customer.address.zip',
          message: 'PLZ des Empfängers fehlt.',
        })
      }
      if (!customerSnapshot.address.city?.trim()) {
        errors.push({
          field: 'customer.address.city',
          message: 'Stadt des Empfängers fehlt.',
        })
      }
      if (!customerSnapshot.address.country?.trim()) {
        errors.push({
          field: 'customer.address.country',
          message: 'Land des Empfängers fehlt.',
        })
      }
    }
  }

  // ============================================
  // LINE ITEMS VALIDATION (Positionen)
  // ============================================
  
  if (lineItems.length === 0) {
    errors.push({
      field: 'lineItems',
      message: 'Bitte fügen Sie mindestens eine Position hinzu.',
    })
  } else {
    lineItems.forEach((item, index) => {
      const positionNum = index + 1

      if (!item.description?.trim()) {
        errors.push({
          field: `lineItems.${index}.description`,
          message: `Position ${positionNum}: Beschreibung fehlt.`,
        })
      }

      if (!item.quantity || item.quantity <= 0) {
        errors.push({
          field: `lineItems.${index}.quantity`,
          message: `Position ${positionNum}: Menge muss größer als 0 sein.`,
        })
      }

      if (!item.unit?.trim()) {
        errors.push({
          field: `lineItems.${index}.unit`,
          message: `Position ${positionNum}: Einheit fehlt.`,
        })
      }

      if (item.unit_price === undefined || item.unit_price === null || item.unit_price < 0) {
        errors.push({
          field: `lineItems.${index}.unit_price`,
          message: `Position ${positionNum}: Ungültiger Preis.`,
        })
      }

      if (item.vat_rate === undefined || item.vat_rate === null || item.vat_rate < 0 || item.vat_rate > 100) {
        errors.push({
          field: `lineItems.${index}.vat_rate`,
          message: `Position ${positionNum}: MwSt.-Satz muss zwischen 0% und 100% liegen.`,
        })
      }
    })
  }

  // ============================================
  // INVOICE DATE VALIDATION
  // ============================================
  
  if (!invoiceDate) {
    errors.push({
      field: 'invoiceDate',
      message: 'Bitte geben Sie ein Rechnungsdatum ein.',
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Formats validation errors into a user-friendly message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return ''
  
  if (errors.length === 1) {
    return errors[0].message
  }

  // Group errors by category
  const issuerErrors = errors.filter(e => e.field.startsWith('issuer'))
  const customerErrors = errors.filter(e => e.field.startsWith('customer'))
  const lineItemErrors = errors.filter(e => e.field.startsWith('lineItems'))
  const otherErrors = errors.filter(e => 
    !e.field.startsWith('issuer') && 
    !e.field.startsWith('customer') && 
    !e.field.startsWith('lineItems')
  )

  const sections: string[] = []

  if (issuerErrors.length > 0) {
    sections.push(`Absender: ${issuerErrors.map(e => e.message).join(' ')}`)
  }
  if (customerErrors.length > 0) {
    sections.push(`Empfänger: ${customerErrors.map(e => e.message).join(' ')}`)
  }
  if (lineItemErrors.length > 0) {
    sections.push(`Positionen: ${lineItemErrors.map(e => e.message).join(' ')}`)
  }
  if (otherErrors.length > 0) {
    sections.push(otherErrors.map(e => e.message).join(' '))
  }

  return sections.join('\n\n')
}
