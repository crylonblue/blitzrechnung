-- Add language support for multilanguage invoices
-- Add enable_english_invoices flag to companies table
ALTER TABLE companies 
ADD COLUMN enable_english_invoices BOOLEAN DEFAULT FALSE;

-- Add language field to invoices table (default 'de', option 'en')
ALTER TABLE invoices 
ADD COLUMN language TEXT DEFAULT 'de' CHECK (language IN ('de', 'en'));

-- Create index for language field for faster filtering
CREATE INDEX idx_invoices_language ON invoices(language);

COMMENT ON COLUMN companies.enable_english_invoices IS 'Whether the company has enabled English invoice generation';
COMMENT ON COLUMN invoices.language IS 'Language of the invoice: de (German) or en (English)';
