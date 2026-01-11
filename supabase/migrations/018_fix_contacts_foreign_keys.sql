-- Fix foreign key constraints to allow contact deletion
-- When a contact is deleted, set the reference to NULL instead of blocking

-- Drop existing foreign keys
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_seller_contact_id_fkey;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_buyer_contact_id_fkey;

-- Re-create with ON DELETE SET NULL
ALTER TABLE invoices 
  ADD CONSTRAINT invoices_seller_contact_id_fkey 
  FOREIGN KEY (seller_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE invoices 
  ADD CONSTRAINT invoices_buyer_contact_id_fkey 
  FOREIGN KEY (buyer_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
