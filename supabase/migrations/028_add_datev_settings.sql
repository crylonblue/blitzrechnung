-- DATEV export settings (chart of accounts, advisor/client number, accounts).
-- Stored as JSONB like email_settings; shape:
-- { skr: 'SKR03'|'SKR04', berater_nr, mandanten_nr, wj_beginn ('MMDD'),
--   sachkontenlaenge, debitor_konto, erloes_konten: { standard19, standard7, steuerfrei, nullsatz } }
ALTER TABLE companies
ADD COLUMN datev_settings JSONB;

COMMENT ON COLUMN companies.datev_settings IS 'DATEV-Buchungsstapel-Export-Konfiguration (Kontenrahmen, Berater-/Mandantennummer, Konten).';
