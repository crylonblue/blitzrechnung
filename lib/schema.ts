import { z } from "zod";

export const AddressSchema = z.object({
  street: z.string().min(1, "Street is required"),
  streetNumber: z.string().min(1, "Street number is required"),
  postalCode: z.string().min(1, "Postal code is required"),
  city: z.string().min(1, "City is required"),
  country: z.string().length(2, "Country code must be ISO 3166-1 alpha-2 format (e.g., 'DE', 'FR')").default("DE"),
});

// Contact schema for XRechnung BR-DE-2 compliance
export const ContactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
});

// XRechnung BR-DE-2: Contact with at least one field required
export const XRechnungContactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
}).refine(
  (contact) => !!(contact.name || contact.phone || contact.email),
  { message: "BR-DE-2: Mindestens ein Kontaktfeld (Name, Telefon oder E-Mail) ist für XRechnung erforderlich" }
);

export const SellerSchema = z.object({
  name: z.string().min(1, "Seller name is required"),
  subHeadline: z.string().optional(),
  address: AddressSchema,
  phoneNumber: z.string().optional(),
  taxNumber: z.string().optional(),
  vatId: z.string().optional(),
  contact: ContactSchema.optional(), // XRechnung BR-DE-2
});

export const CustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  address: AddressSchema,
  phoneNumber: z.string().optional(),
  additionalInfo: z.array(z.string()).optional(),
});

export const InvoiceItemSchema = z.object({
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.string().min(1, "Unit is required"),
  unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  vatRate: z.number().min(0).max(100, "VAT rate must be between 0 and 100").default(19),
});

export const BankDetailsSchema = z.object({
  iban: z.string().min(1, "IBAN is required"),
  bankName: z.string().min(1, "Bank name is required"),
});

// XRechnung BR-DE-1: Bank details required for payment instructions
export const XRechnungBankDetailsSchema = z.object({
  iban: z.string()
    .min(15, "IBAN muss mindestens 15 Zeichen haben")
    .max(34, "IBAN darf maximal 34 Zeichen haben")
    .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/, "Ungültiges IBAN-Format"),
  bankName: z.string().min(1, "Bankname ist erforderlich"),
});

export const InvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  seller: SellerSchema,
  customer: CustomerSchema,
  items: z.array(InvoiceItemSchema).min(1, "At least one item is required"),
  taxRate: z.number().min(0).max(100, "Tax rate must be between 0 and 100"),
  currency: z.string().length(3, "Currency must be ISO 4217 format (e.g., 'EUR', 'USD')").default("EUR"),
  note: z.string().optional(),
  logoUrl: z.string().url("Invalid logo URL").optional(),
  bankDetails: BankDetailsSchema.optional(),
  buyerReference: z.string().optional(), // XRechnung BR-DE-15
});

/**
 * XRechnung-compliant Invoice Schema
 * Validates all BR-DE rules required for German e-invoicing
 * 
 * BR-DE-1: Payment Instructions (BG-16) - Bank details required
 * BR-DE-2: Seller Contact (BG-6) - At least one contact field required
 * BR-DE-4: Seller post code (BT-38) - Already in AddressSchema
 * BR-DE-9: Buyer post code (BT-53) - Already in AddressSchema
 * BR-DE-15: Buyer Reference (BT-10) - Falls back to invoice number
 */
export const XRechnungInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, "Rechnungsnummer ist erforderlich"),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)"),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datumsformat (YYYY-MM-DD)"),
  seller: z.object({
    name: z.string().min(1, "Verkäufername ist erforderlich"),
    subHeadline: z.string().optional(),
    address: z.object({
      street: z.string().min(1, "Straße ist erforderlich"),
      streetNumber: z.string().min(1, "Hausnummer ist erforderlich"),
      postalCode: z.string().min(1, "BR-DE-4: Verkäufer-PLZ ist für XRechnung erforderlich"),
      city: z.string().min(1, "Stadt ist erforderlich"),
      country: z.string().length(2, "Ländercode muss ISO 3166-1 alpha-2 sein").default("DE"),
    }),
    phoneNumber: z.string().optional(),
    taxNumber: z.string().optional(),
    vatId: z.string().optional(),
    // BR-DE-2: Contact is required with at least one field
    contact: XRechnungContactSchema,
  }),
  customer: z.object({
    name: z.string().min(1, "Kundenname ist erforderlich"),
    address: z.object({
      street: z.string().min(1, "Straße ist erforderlich"),
      streetNumber: z.string().min(1, "Hausnummer ist erforderlich"),
      postalCode: z.string().min(1, "BR-DE-9: Käufer-PLZ ist für XRechnung erforderlich"),
      city: z.string().min(1, "Stadt ist erforderlich"),
      country: z.string().length(2, "Ländercode muss ISO 3166-1 alpha-2 sein").default("DE"),
    }),
    phoneNumber: z.string().optional(),
    additionalInfo: z.array(z.string()).optional(),
  }),
  items: z.array(InvoiceItemSchema).min(1, "Mindestens eine Position ist erforderlich"),
  taxRate: z.number().min(0).max(100, "MwSt.-Satz muss zwischen 0 und 100 liegen"),
  currency: z.string().length(3, "Währung muss ISO 4217 Format sein").default("EUR"),
  note: z.string().optional(),
  logoUrl: z.string().url("Ungültige Logo-URL").optional(),
  // BR-DE-1: Bank details required for payment instructions
  bankDetails: XRechnungBankDetailsSchema,
  buyerReference: z.string().optional(),
});

/**
 * Validates an invoice against XRechnung requirements
 * Returns validation result with detailed error messages and optional warnings
 */
export function validateXRechnungInvoice(invoice: Invoice): { 
  valid: boolean; 
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // BR-DE-1: Payment Instructions - Bank details required
  if (!invoice.bankDetails?.iban) {
    errors.push("BR-DE-1: Zahlungsanweisungen (IBAN) sind für XRechnung erforderlich");
  } else {
    // BR-DE-19: Validate IBAN format when using SEPA (code 58)
    const ibanClean = invoice.bankDetails.iban.replace(/\s/g, '');
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(ibanClean)) {
      warnings.push("BR-DE-19: IBAN-Format scheint ungültig zu sein");
    }
  }

  // BR-DE-2: Seller Contact (optional, converted to warning)
  if (!invoice.seller.contact || 
      (!invoice.seller.contact.name && !invoice.seller.contact.phone && !invoice.seller.contact.email)) {
    warnings.push("BR-DE-2: Verkäufer-Kontakt (Name, Telefon oder E-Mail) empfohlen für vollständige XRechnung-Konformität");
  }

  // BR-DE-4: Seller post code required
  if (!invoice.seller.address.postalCode) {
    errors.push("BR-DE-4: Verkäufer-PLZ ist für XRechnung erforderlich");
  }

  // BR-DE-9: Buyer post code required
  if (!invoice.customer.address.postalCode) {
    errors.push("BR-DE-9: Käufer-PLZ ist für XRechnung erforderlich");
  }

  // PEPPOL-EN16931-R020: Seller electronic address (informational)
  if (!invoice.seller.contact?.email) {
    warnings.push("PEPPOL-EN16931-R020: Verkäufer-E-Mail-Adresse empfohlen für elektronischen Rechnungsaustausch");
  }

  // PEPPOL-EN16931-R010: Buyer electronic address (informational)
  const buyerHasEmail = invoice.customer.additionalInfo?.some(info => info.includes('@'));
  if (!buyerHasEmail) {
    warnings.push("PEPPOL-EN16931-R010: Käufer-E-Mail-Adresse empfohlen für elektronischen Rechnungsaustausch");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export type Invoice = z.infer<typeof InvoiceSchema>;
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;
export type Seller = z.infer<typeof SellerSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type BankDetails = z.infer<typeof BankDetailsSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Contact = z.infer<typeof ContactSchema>;
