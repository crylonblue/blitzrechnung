-- Add new status values to invoices (reminded, cancelled)
DO $$
BEGIN
  -- Only drop constraint if it exists (silent, no NOTICE)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'invoices_status_check' 
    AND table_name = 'invoices'
  ) THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
  END IF;
END $$;

ALTER TABLE invoices 
ADD CONSTRAINT invoices_status_check 
CHECK (status IN ('draft', 'created', 'sent', 'reminded', 'paid', 'cancelled'));
