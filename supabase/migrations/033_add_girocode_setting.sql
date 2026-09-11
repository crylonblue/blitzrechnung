-- Girocode (EPC069-12 QR code) on invoice PDFs.
--
-- Defaults to TRUE: if a company has filled in an IBAN, printing a QR code that
-- pre-fills the customer's banking app is what they want by default, and the
-- code is omitted automatically when the bank details can't produce a valid
-- SEPA credit transfer. The column exists for the minority who invoice by
-- direct debit or on account and don't want customers paying by transfer.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS invoice_show_girocode BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN companies.invoice_show_girocode IS
  'Print the EPC/Girocode QR code on invoice PDFs when valid bank details exist.';
