-- Englische Fassung von Einleitungs- und Schlusstext.
--
-- Bisher gab es nur einen (deutschen) Text pro Firma, der auch auf englischen
-- Rechnungen landete. Wie in Migration 022 bekommen bestehende Firmen einen
-- sinnvollen Standardtext, damit englische Rechnungen sofort passen.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_intro_text_en TEXT,
  ADD COLUMN IF NOT EXISTS default_outro_text_en TEXT;

UPDATE companies
SET
  default_intro_text_en = 'Thank you for your business. Please transfer the invoice amount within the stated payment term.',
  default_outro_text_en = 'Thank you for your order. If you have any questions about this invoice, please do not hesitate to contact us.'
WHERE default_intro_text_en IS NULL AND default_outro_text_en IS NULL;
