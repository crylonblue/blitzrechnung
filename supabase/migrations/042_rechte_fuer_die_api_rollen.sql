-- Die Migrationskette erteilt den API-Rollen keine Rechte auf die Tabellen.
--
-- Aufgefallen beim ersten Aufbau einer lokalen Datenbank: Nach `supabase db
-- reset` beantwortet PostgREST jeden Aufruf mit 403. Nachgesehen:
--
--   company_users -> anon:          TRUNCATE, REFERENCES, TRIGGER
--                    authenticated: TRUNCATE, REFERENCES, TRIGGER
--
-- Kein SELECT, kein INSERT, kein UPDATE. Im gehosteten Projekt existieren
-- diese Rechte, aber sie wurden dort ausserhalb der Migrationen gesetzt —
-- beim Anlegen des Projekts. In der Kette selbst stehen sie nirgends.
--
-- Folge: Eine Datenbank, die allein aus diesen Migrationen entsteht, ist
-- unbenutzbar. Das betrifft nicht nur die lokale Entwicklung, sondern jeden
-- Wiederaufbau — ein Staging-Projekt, einen Notfall, einen Umzug. Der
-- probelauf in der CI prueft bisher, dass die Migrationen *durchlaufen*,
-- nicht dass dabei etwas Brauchbares herauskommt.
--
-- Gegen die Produktion ist diese Migration ein Leerlauf: Dort sind die
-- Rechte laengst vergeben, GRANT ist idempotent.
--
-- Zur Sicherheit: Rechte fuer `anon` sind hier vertretbar, weil auf allen
-- zehn Tabellen des Schemas RLS aktiviert ist (nachgeprueft, nicht
-- angenommen). Die Rechte sind die Tuer, RLS ist das Schloss. Kommt je eine
-- Tabelle ohne RLS dazu, waere sie ueber `anon` offen — deshalb steht am
-- Ende dieser Datei eine Pruefung, die genau das verhindert.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Damit kuenftige Tabellen nicht wieder ohne Rechte dastehen.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Wachhund: Eine Tabelle ohne RLS waere ueber die soeben erteilten Rechte
-- fuer jeden Besucher offen. Lieber hier laut scheitern als still oeffnen.
DO $$
DECLARE
  offen TEXT;
BEGIN
  SELECT string_agg(tablename, ', ')
  INTO offen
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = false;

  IF offen IS NOT NULL THEN
    RAISE EXCEPTION
      'Tabellen ohne Row Level Security im Schema public: %. Diese Migration erteilt anon Rechte auf alle Tabellen; ohne RLS waeren sie oeffentlich lesbar. Bitte RLS aktivieren, bevor diese Migration laeuft.', offen;
  END IF;
END $$;
