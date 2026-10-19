-- Kleinunternehmerregelung nach § 19 UStG.
--
-- Ein grosser Teil der Zielgruppe — Freelancer und Solo-Selbststaendige —
-- faellt darunter und weist auf Rechnungen keine Umsatzsteuer aus. Bisher
-- mussten Betroffene je Position "Steuerfrei · § 4 UStG" waehlen und den
-- § 19-Grund von Hand eintragen, also die falsche Steuerkategorie mit einem
-- richtigen Text ueberschreiben.
--
-- Standard ist FALSE: Bestehende Firmen rechnen weiter wie bisher ab. Wer die
-- Regelung nutzt, schaltet sie in den Einstellungen ein.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS kleinunternehmer BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN companies.kleinunternehmer IS
  'Kleinunternehmer nach § 19 UStG: Rechnungen weisen keine Umsatzsteuer aus, alle Positionen erhalten Steuerkategorie E mit Begruendung (BT-120).';
