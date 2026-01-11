import type { Invoice as PDFInvoice } from './schema'
import type { Invoice as DBInvoice, PartySnapshot, LineItem } from '@/types'

/**
 * Maps database invoice format to PDF invoice schema format
 * 
 * @param dbInvoice - The database invoice record
 * @param sellerSnapshot - The seller/issuer snapshot (company or external contact)
 * @param buyerSnapshot - The buyer snapshot (external contact or company)
 * @param companyLogoUrl - Optional company logo URL
 */
export function mapDBInvoiceToPDFInvoice(
  dbInvoice: DBInvoice,
  sellerSnapshot: PartySnapshot | null,
  buyerSnapshot: PartySnapshot,
  companyLogoUrl?: string | null
): PDFInvoice {
  const lineItems = (dbInvoice.line_items as unknown as LineItem[]) || []
  
  // Calculate default tax rate from line items
  // Use proper check for undefined/null (0 is a valid rate!)
  const defaultTaxRate = lineItems.length > 0 && lineItems[0].vat_rate !== undefined && lineItems[0].vat_rate !== null
    ? lineItems[0].vat_rate 
    : 19

  // Map line items with individual VAT rates
  const items = lineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit || 'piece', // Use unit from line item or default to piece
    unitPrice: item.unit_price,
    vatRate: item.vat_rate !== undefined && item.vat_rate !== null ? item.vat_rate : defaultTaxRate,
  }))

  // Map seller including contact for XRechnung BR-DE-2
  const seller = sellerSnapshot
    ? {
        name: sellerSnapshot.name,
        subHeadline: undefined,
        address: {
          street: sellerSnapshot.address.street,
          streetNumber: sellerSnapshot.address.streetnumber,
          postalCode: sellerSnapshot.address.zip,
          city: sellerSnapshot.address.city,
          country: sellerSnapshot.address.country,
        },
        phoneNumber: undefined,
        taxNumber: sellerSnapshot.tax_id,
        vatId: sellerSnapshot.vat_id,
        // XRechnung BR-DE-2: Seller Contact (required)
        contact: sellerSnapshot.contact ? {
          name: sellerSnapshot.contact.name,
          phone: sellerSnapshot.contact.phone,
          email: sellerSnapshot.contact.email,
        } : undefined,
      }
    : {
        name: '',
        subHeadline: undefined,
        address: {
          street: '',
          streetNumber: '',
          postalCode: '',
          city: '',
          country: 'DE',
        },
        phoneNumber: undefined,
        taxNumber: undefined,
        vatId: undefined,
        contact: undefined,
      }

  // Map buyer
  const customer = {
    name: buyerSnapshot.name,
    address: {
      street: buyerSnapshot.address.street,
      streetNumber: buyerSnapshot.address.streetnumber,
      postalCode: buyerSnapshot.address.zip,
      city: buyerSnapshot.address.city,
      country: buyerSnapshot.address.country,
    },
    phoneNumber: undefined,
    additionalInfo: buyerSnapshot.email ? [buyerSnapshot.email] : undefined,
  }

  // Map bank details from seller
  const bankDetails = sellerSnapshot?.bank_details?.iban
    ? {
        iban: sellerSnapshot.bank_details.iban,
        bankName: sellerSnapshot.bank_details.bank_name || '',
      }
    : undefined

  return {
    invoiceNumber: dbInvoice.invoice_number || '',
    invoiceDate: dbInvoice.invoice_date || new Date().toISOString().split('T')[0],
    serviceDate: dbInvoice.invoice_date || new Date().toISOString().split('T')[0], // Use invoice_date as service_date
    seller,
    customer,
    items,
    taxRate: defaultTaxRate, // Default rate for backwards compatibility
    currency: 'EUR',
    note: undefined,
    logoUrl: companyLogoUrl || undefined,
    bankDetails,
    // XRechnung BR-DE-15: Buyer Reference (uses invoice number as fallback)
    buyerReference: dbInvoice.invoice_number || undefined,
  }
}

