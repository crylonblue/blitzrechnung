-- CHECK Constraints für Invoice seller/buyer Kombinationen
-- Verhindert ungültige Datenzustände

-- =====================================================
-- SCHRITT 1: Bestehende Daten korrigieren
-- =====================================================

-- Wenn seller_is_self = false aber seller_contact_id NULL ist,
-- setze seller_is_self auf true (war wahrscheinlich Standard-Verhalten)
UPDATE invoices 
SET seller_is_self = true 
WHERE seller_is_self = false AND seller_contact_id IS NULL;

-- Wenn buyer_is_self = false aber buyer_contact_id NULL ist,
-- behalte es als false nur wenn buyer_snapshot existiert (legacy Daten)
-- Ansonsten ist es ein Entwurf ohne Empfänger - das ist okay
-- Keine Aktion nötig für Drafts

-- Wenn seller_is_self = true aber seller_contact_id gesetzt ist, 
-- lösche die contact_id (Inkonsistenz)
UPDATE invoices 
SET seller_contact_id = NULL 
WHERE seller_is_self = true AND seller_contact_id IS NOT NULL;

-- Wenn buyer_is_self = true aber buyer_contact_id gesetzt ist,
-- lösche die contact_id (Inkonsistenz)
UPDATE invoices 
SET buyer_contact_id = NULL 
WHERE buyer_is_self = true AND buyer_contact_id IS NOT NULL;

-- =====================================================
-- SCHRITT 2: Constraints hinzufügen
-- =====================================================

-- 1. Verhindere dass Firma an sich selbst Rechnung stellt
-- (seller_is_self = true UND buyer_is_self = true ist ungültig)
ALTER TABLE invoices ADD CONSTRAINT chk_not_self_to_self
  CHECK (NOT (seller_is_self = true AND buyer_is_self = true));

-- 2. Wenn seller_is_self = false, muss seller_contact_id gesetzt sein
ALTER TABLE invoices ADD CONSTRAINT chk_seller_contact_required
  CHECK (seller_is_self = true OR seller_contact_id IS NOT NULL);

-- 3. Wenn buyer_is_self = false, muss buyer_contact_id gesetzt sein
-- AUSNAHME: Drafts dürfen noch keinen Buyer haben
ALTER TABLE invoices ADD CONSTRAINT chk_buyer_contact_required
  CHECK (buyer_is_self = true OR buyer_contact_id IS NOT NULL OR status = 'draft');

-- 4. Wenn seller_is_self = true, sollte seller_contact_id NULL sein (Konsistenz)
ALTER TABLE invoices ADD CONSTRAINT chk_seller_self_no_contact
  CHECK (seller_is_self = false OR seller_contact_id IS NULL);

-- 5. Wenn buyer_is_self = true, sollte buyer_contact_id NULL sein (Konsistenz)
ALTER TABLE invoices ADD CONSTRAINT chk_buyer_self_no_contact
  CHECK (buyer_is_self = false OR buyer_contact_id IS NULL);
