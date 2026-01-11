-- Atomare Invoice-Nummern-Vergabe
-- Verhindert Race Conditions bei gleichzeitiger Rechnungserstellung

-- 1. Counter-Spalte zur companies Tabelle hinzufügen
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_number_counter INTEGER DEFAULT 0;

-- 2. Bestehende Zähler initialisieren basierend auf existierenden Rechnungen
UPDATE companies c
SET invoice_number_counter = COALESCE(
  (
    SELECT MAX(
      CASE 
        WHEN i.invoice_number ~ '\d+$' 
        THEN (regexp_match(i.invoice_number, '(\d+)$'))[1]::integer
        ELSE 0
      END
    )
    FROM invoices i
    WHERE i.company_id = c.id
      AND i.status != 'draft'
      AND i.seller_is_self = true
  ),
  0
);

-- 3. Funktion für atomare Nummernvergabe erstellen
CREATE OR REPLACE FUNCTION get_next_invoice_number(
  p_seller_type TEXT,  -- 'company' oder 'contact'
  p_seller_id UUID,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TABLE (
  next_number INTEGER,
  formatted_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_counter INTEGER;
  v_prefix TEXT;
BEGIN
  IF p_seller_type = 'company' THEN
    -- Atomares Update für Company
    UPDATE companies
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;
    
    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Company not found: %', p_seller_id;
    END IF;
    
    -- Prefix aus Parameter überschreibt den gespeicherten
    IF p_prefix IS NOT NULL THEN
      v_prefix := p_prefix;
    END IF;
    
  ELSIF p_seller_type = 'contact' THEN
    -- Atomares Update für Contact
    UPDATE contacts
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;
    
    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;
    
    -- Prefix aus Parameter überschreibt den gespeicherten
    IF p_prefix IS NOT NULL THEN
      v_prefix := p_prefix;
    END IF;
    
  ELSE
    RAISE EXCEPTION 'Invalid seller_type: %. Must be "company" or "contact"', p_seller_type;
  END IF;
  
  -- Formatierte Nummer generieren
  next_number := v_counter;
  formatted_number := COALESCE(v_prefix, 'INV') || '-' || LPAD(v_counter::TEXT, 4, '0');
  
  RETURN NEXT;
END;
$$;

-- 4. Grant execute permission für authenticated users
GRANT EXECUTE ON FUNCTION get_next_invoice_number(TEXT, UUID, TEXT) TO authenticated;
