-- Enforce per-company uniqueness of issued invoice numbers.
-- Legally an issuer's invoice numbers must be unique; the atomic counter
-- (migration 019) prevents collisions in the normal flow, but direct-write
-- paths (manual numbers, finalize, cancellation) could bypass it. This is the
-- DB-level safety net. Drafts (NULL / not yet issued) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_number
  ON invoices (company_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND status <> 'draft';
