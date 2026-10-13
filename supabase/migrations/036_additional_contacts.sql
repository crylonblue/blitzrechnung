-- Weitere Ansprechpartner pro Firma.
--
-- Der bestehende Ansprechpartner (contact_name/phone/email) bleibt der
-- Standard. Firmen, in denen mehrere Abteilungen Rechnungen schreiben, können
-- weitere hinterlegen und pro Rechnung auswählen. Der gewählte Ansprechpartner
-- steht auf der Rechnung und wird beim Versand zur Antwortadresse.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS additional_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN companies.additional_contacts IS 'Weitere Ansprechpartner: [{ id, name, phone?, email? }]';

-- NULL = Standard-Ansprechpartner der Firma. Verweist auf additional_contacts[].id;
-- beim Finalisieren landet der aufgelöste Kontakt im seller_snapshot.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS contact_person_id TEXT;
