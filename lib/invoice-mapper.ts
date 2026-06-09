import type { Invoice as PDFInvoice } from './schema'
import type { Invoice as DBInvoice, PartySnapshot, LineItem } from '@/types'

/**
 * Maps database invoice format to PDF invoice schema format
 * 
 * Legal info and contact details are now read directly from the sellerSnapshot,
 * which includes these fields for both company and contact sellers.
 * 
 * @param dbInvoice - The database invoice record
 * @param sellerSnapshot - The seller/issuer snapshot (includes legal info, contact details)
 * @param buyerSnapshot - The buyer snapshot (external contact or company)
 * @param companyLogoUrl - Optional company logo URL
 * @param introText - Optional intro text to display under the invoice headline
 * @param outroText - Optional outro text to display after line items/totals
 * @param buyerReference - Optional buyer reference/PO number
 */
export function mapDBInvoiceToPDFInvoice(
  dbInvoice: DBInvoice,
  sellerSnapshot: PartySnapshot | null,
  buyerSnapshot: PartySnapshot,
  companyLogoUrl?: string | null,
  introText?: string | null,
  outroText?: string | null,
  buyerReference?: string | null
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
    taxCategory: item.tax_category, // BT-151 VAT category (S/Z/E/AE)
    exemptionReason: item.exemption_reason, // BT-120 reason for E/AE
  }))

  // Map seller including contact for XRechnung BR-DE-2 and legal info for footer
  // Legal info is now read directly from the seller snapshot (works for both company and contact sellers)
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
        phoneNumber: sellerSnapshot.contact?.phone || undefined,
        email: sellerSnapshot.email || sellerSnapshot.contact?.email || undefined,
        taxNumber: sellerSnapshot.tax_id,
        vatId: sellerSnapshot.vat_id,
        // XRechnung BR-DE-2: Seller Contact (required)
        contact: sellerSnapshot.contact ? {
          name: sellerSnapshot.contact.name,
          phone: sellerSnapshot.contact.phone,
          email: sellerSnapshot.contact.email,
        } : undefined,
        // Legal information for PDF footer (from snapshot)
        court: sellerSnapshot.court || undefined,
        registerNumber: sellerSnapshot.register_number || undefined,
        managingDirector: sellerSnapshot.managing_director || undefined,
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
        email: undefined,
        taxNumber: undefined,
        vatId: undefined,
        contact: undefined,
        court: undefined,
        registerNumber: undefined,
        managingDirector: undefined,
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
    vatId: buyerSnapshot.vat_id || undefined, // BT-48 buyer VAT identifier
  }

  // Map bank details from seller
  const bankDetails = sellerSnapshot?.bank_details?.iban
    ? {
        iban: sellerSnapshot.bank_details.iban,
        bankName: sellerSnapshot.bank_details.bank_name || '',
        bic: sellerSnapshot.bank_details.bic || undefined,
      }
    : undefined

  return {
    invoiceNumber: dbInvoice.invoice_number || '',
    invoiceDate: dbInvoice.invoice_date || new Date().toISOString().split('T')[0],
    serviceDate: dbInvoice.service_date || dbInvoice.invoice_date || new Date().toISOString().split('T')[0], // Leistungsdatum (BT-72); falls back to invoice date
    dueDate: dbInvoice.due_date || undefined, // Payment due date (BT-9); generator falls back to +14 days if absent
    seller,
    customer,
    items,
    taxRate: defaultTaxRate, // Default rate for backwards compatibility
    currency: 'EUR',
    note: undefined,
    introText: introText || undefined, // Intro text displayed under the invoice headline
    outroText: outroText || undefined, // Outro text displayed after line items/totals
    logoUrl: companyLogoUrl || undefined,
    bankDetails,
    // XRechnung BR-DE-15: Buyer Reference (uses provided value or falls back to invoice number)
    buyerReference: buyerReference || dbInvoice.invoice_number || undefined,
  }
}

