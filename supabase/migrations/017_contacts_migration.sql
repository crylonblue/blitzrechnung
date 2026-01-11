-- Migration: customers -> contacts
-- Universelle Kontakt-Entity die sowohl als Seller als auch als Buyer auftreten kann

-- 1. Contacts Tabelle erstellen (ersetzt customers)
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address JSONB NOT NULL,
  email TEXT,
  vat_id TEXT,
  
  -- Seller-spezifische Felder (wenn dieser Kontakt Rechnungen stellen kann)
  invoice_number_prefix TEXT,
  invoice_number_counter INTEGER DEFAULT 0,
  tax_id TEXT,
  bank_details JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Daten von customers nach contacts migrieren
INSERT INTO contacts (id, company_id, name, address, email, vat_id, created_at, updated_at)
SELECT id, company_id, name, address, email, vat_id, created_at, updated_at
FROM customers;

-- 3. Invoices erweitern mit seller/buyer Flags
ALTER TABLE invoices 
  ADD COLUMN seller_is_self BOOLEAN DEFAULT true,
  ADD COLUMN seller_contact_id UUID REFERENCES contacts(id),
  ADD COLUMN buyer_is_self BOOLEAN DEFAULT false,
  ADD COLUMN buyer_contact_id UUID REFERENCES contacts(id);

-- 4. Bestehende Invoices migrieren: customer_snapshot -> buyer_contact_id
UPDATE invoices 
SET buyer_contact_id = (customer_snapshot->>'id')::uuid,
    buyer_is_self = false,
    seller_is_self = true
WHERE customer_snapshot IS NOT NULL 
  AND customer_snapshot->>'id' IS NOT NULL;

-- 5. Rename snapshots für Klarheit
ALTER TABLE invoices RENAME COLUMN customer_snapshot TO buyer_snapshot;
ALTER TABLE invoices RENAME COLUMN issuer_snapshot TO seller_snapshot;

-- 6. Indexes für Performance
CREATE INDEX idx_contacts_company_id ON contacts(company_id);
CREATE INDEX idx_contacts_name ON contacts(name);
CREATE INDEX idx_invoices_seller_contact_id ON invoices(seller_contact_id);
CREATE INDEX idx_invoices_buyer_contact_id ON invoices(buyer_contact_id);

-- 7. RLS Policies für contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts of their companies"
  ON contacts FOR SELECT
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert contacts for their companies"
  ON contacts FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update contacts of their companies"
  ON contacts FOR UPDATE
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete contacts of their companies"
  ON contacts FOR DELETE
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

-- 8. Updated_at Trigger
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Alte customers Tabelle löschen (nach erfolgreicher Migration)
DROP TABLE customers;
