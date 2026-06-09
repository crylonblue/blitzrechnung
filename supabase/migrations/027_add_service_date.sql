-- Add a separate service/delivery date (Leistungsdatum, §14 UStG, BT-72).
-- Until now the service date was hard-wired to the invoice date, which is wrong
-- whenever the service was rendered in a different period than the invoice date
-- (e.g. work done in May, invoiced in June).
ALTER TABLE invoices
ADD COLUMN service_date DATE;

-- Backfill existing rows so behaviour is unchanged for already-created invoices.
UPDATE invoices
SET service_date = invoice_date
WHERE service_date IS NULL;

COMMENT ON COLUMN invoices.service_date IS 'Leistungs-/Lieferdatum (§14 UStG, XRechnung BT-72). Defaults to the invoice date when not set explicitly.';
