-- Abrechnung pro Platz: Stripe rechnet Preis × Menge, die Menge ist die Zahl der
-- Mitglieder der Firma. Hier steht die Menge, die Stripe zuletzt gemeldet hat
-- (nur der Webhook schreibt sie), damit die Einstellungen sie anzeigen können.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1);
