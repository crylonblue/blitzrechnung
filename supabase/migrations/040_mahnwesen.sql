-- Mahnwesen: Datenfundament.
--
-- Diese Migration legt nur Tabellen und Spalten an. Es gibt noch keine
-- Oberflaeche, keine Route und kein PDF; nichts davon wird fuer Nutzer
-- sichtbar. Auch Standardzeilen werden bewusst keine angelegt (siehe unten).
--
-- Eine Mahnung ist keine Rechnung und bekommt deshalb eine eigene Tabelle:
-- Sie traegt keine Pflichten nach § 14 UStG, braucht keine fortlaufende
-- Nummer und kein ZUGFeRD/XRechnung-XML. In `invoices` wuerde sie
-- Rechnungsnummern verbrauchen, mit dem eindeutigen Index aus Migration 029
-- kollidieren und den DATEV-Export sowie die Umsatzkennzahlen des Dashboards
-- mit Belegen fuettern, die kein Umsatz sind.
--
-- Mahngebuehren und Verzugszinsen sind Schadensersatz, kein Entgelt. Sie
-- unterliegen keiner Umsatzsteuer — deshalb gibt es hier kein vat_amount und
-- soll es auch keines geben.


-- ---------------------------------------------------------------------------
-- 1. Kundenart am Kontakt
-- ---------------------------------------------------------------------------
--
-- Bewusst NULL-faehig: NULL heisst "unbekannt", nicht "Unternehmen". Gefragt
-- wird einmalig im Mahnen-Dialog, nicht im Kontaktformular — wer nie mahnt,
-- soll das Feld nie zu sehen bekommen, und ein falsch geratener Standardwert
-- waere schlimmer als eine ehrliche Luecke.
--
-- An dieser Angabe haengen drei Regeln:
--   * Verzugszinssatz: 9 Prozentpunkte ueber dem Basiszinssatz gegenueber
--     Unternehmen (§ 288 Abs. 2 BGB), 5 gegenueber Verbrauchern (Abs. 1).
--   * Die Pauschale von 40 Euro (§ 288 Abs. 5 BGB) gibt es nur gegenueber
--     Unternehmen.
--   * Gegenueber Verbrauchern tritt Verzug 30 Tage nach Faelligkeit nur ein,
--     wenn auf diese Folge in der Rechnung hingewiesen wurde (§ 286 Abs. 3
--     Satz 2 BGB).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS customer_type TEXT
    CHECK (customer_type IN ('business', 'consumer'));

COMMENT ON COLUMN contacts.customer_type IS
  'Unternehmer oder Verbraucher; NULL = unbekannt. Bestimmt Zinssatz (§ 288 Abs. 1/2 BGB), die 40-Euro-Pauschale (§ 288 Abs. 5 BGB) und die Hinweispflicht (§ 286 Abs. 3 BGB).';


-- ---------------------------------------------------------------------------
-- 2. Platz fuer "uneinbringlich" im Rechnungsstatus
-- ---------------------------------------------------------------------------
--
-- Der Wert wird hier nur zugelassen, nicht vergeben: Es gibt noch keine
-- Stelle, die ihn setzt, und keine, die ihn anzeigt.
--
-- Stornieren und Ausbuchen sind buchhalterisch zweierlei. Eine Stornorechnung
-- sagt "die Rechnung war falsch" — Umsatz und Umsatzsteuer werden
-- zurueckgenommen. Eine uneinbringliche Forderung sagt "die Rechnung war
-- richtig, das Geld kommt nicht" — der Umsatz bleibt stehen, die Forderung
-- wird abgeschrieben und die Umsatzsteuer nach § 17 UStG berichtigt. Wer
-- Letzteres als Storno bucht, meldet dem Finanzamt einen Umsatz zu wenig.
--
-- Ein CHECK laesst sich nicht erweitern, er muss ersetzt werden. Der Name
-- stammt aus Migration 010, die den Constraint zuletzt definiert hat.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'created', 'sent', 'reminded', 'paid', 'cancelled', 'uneinbringlich'));


-- ---------------------------------------------------------------------------
-- 3. Eskalationsstufen je Firma
-- ---------------------------------------------------------------------------
--
-- Wie oft, wie schnell und mit welchen Nebenforderungen gemahnt wird, ist eine
-- Geschaeftsentscheidung und keine Konstante — ein Handwerksbetrieb mahnt
-- anders als eine Agentur mit Rahmenvertraegen. Deshalb frei konfigurierbar.
--
-- Wichtig: Diese Tabelle bleibt leer. Es werden weder in dieser Migration noch
-- in create_company_with_owner Standardzeilen je Firma angelegt. Hat eine Firma
-- keine eigenen Stufen, gilt der Standardsatz aus lib/dunning-stages.ts. Das
-- erspart eine Migration ueber den gesamten Bestand, haelt den Standard an
-- einer Stelle aenderbar — und "auf Standard zuruecksetzen" ist schlicht ein
-- DELETE statt eines Wiederherstellungsverfahrens.
CREATE TABLE dunning_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Reihenfolge der Eskalation, bei 1 beginnend und ohne Luecken gedacht.
  position SMALLINT NOT NULL CHECK (position >= 1),
  -- Steht spaeter so im Briefkopf: "Zahlungserinnerung", "1. Mahnung", ...
  name TEXT NOT NULL CHECK (btrim(name) <> ''),

  -- Tage bis zu dieser Stufe: bei Stufe 1 nach Faelligkeit der Rechnung, sonst
  -- nach Ablauf der Frist, die die Vorstufe eingeraeumt hat. Relativ und nicht
  -- absolut, damit eine verspaetet verschickte Mahnung die naechste nicht
  -- rueckwirkend faellig stellt.
  days_after_previous SMALLINT NOT NULL CHECK (days_after_previous >= 0),
  -- Neue Zahlungsfrist, die diese Stufe einraeumt.
  grace_days SMALLINT NOT NULL CHECK (grace_days >= 0),

  -- Mahngebuehr. Ersatzfaehig sind nur tatsaechliche Kosten (Porto, Material),
  -- nie die eigene Arbeitszeit — bei einer E-Mail also praktisch nichts.
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  -- Verzugszinsen nach § 288 BGB ab dieser Stufe berechnen.
  charge_interest BOOLEAN NOT NULL DEFAULT false,
  -- Pauschale von 40 Euro nach § 288 Abs. 5 BGB. Sie faellt einmal je
  -- Forderung an, nicht je Schreiben — in einem sinnvollen Satz steht sie
  -- deshalb auf hoechstens einer Stufe.
  charge_late_fee_flat BOOLEAN NOT NULL DEFAULT false,

  -- Textbausteine; NULL heisst "Standardtext". Die Texte selbst kommen in
  -- einer spaeteren Iteration.
  intro_text TEXT,
  outro_text TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (company_id, position)
);

CREATE INDEX idx_dunning_stages_company_id ON dunning_stages(company_id);

COMMENT ON TABLE dunning_stages IS
  'Eskalationsstufen je Firma. Leer = es gilt der Standardsatz aus lib/dunning-stages.ts.';

ALTER TABLE dunning_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dunning stages of their companies"
  ON dunning_stages FOR SELECT
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert dunning stages for their companies"
  ON dunning_stages FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update dunning stages of their companies"
  ON dunning_stages FOR UPDATE
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

-- Loeschen ist hier das "Zuruecksetzen auf Standard" und deshalb erlaubt;
-- bereits geschriebene Mahnungen haengen nicht daran (siehe unten).
CREATE POLICY "Users can delete dunning stages of their companies"
  ON dunning_stages FOR DELETE
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_dunning_stages_updated_at BEFORE UPDATE ON dunning_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 4. Die Mahnungen selbst
-- ---------------------------------------------------------------------------
CREATE TABLE payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- Stufe, eingefroren: Position und Name werden aus dunning_stages kopiert,
  -- es gibt bewusst KEINEN Fremdschluessel dorthin. Sonst aendert sich der
  -- Briefkopf einer zwei Jahre alten Mahnung, sobald jemand die Stufe
  -- umbenennt — und beim Loeschen der Stufe verschwaende die Mahnung ganz.
  -- Dieselbe Ueberlegung wie bei seller_snapshot/buyer_snapshot auf invoices.
  stage_position SMALLINT NOT NULL CHECK (stage_position >= 1),
  stage_name TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'sent')),

  reminder_date DATE NOT NULL,
  -- Die neue Zahlungsfrist, die diese Mahnung einraeumt.
  due_date DATE NOT NULL,
  -- Die Faelligkeit der Rechnung, wie sie beim Schreiben der Mahnung galt.
  -- Eingefroren, weil sie die Grundlage fuer Verzug und Zinszeitraum ist,
  -- invoices.due_date aber nullbar und nachtraeglich aenderbar.
  invoice_due_date DATE NOT NULL,

  -- Was tatsaechlich gefordert wird. Getrennt von invoices.total_amount, weil
  -- es keine Teilzahlungen in der Datenhaltung gibt: Hat der Kunde einen Teil
  -- gezahlt, sinkt hier die Forderung, statt dass eine Zahlungstabelle
  -- erfunden wird.
  claimed_amount NUMERIC(10,2) NOT NULL CHECK (claimed_amount > 0),
  -- Mahngebuehr dieser Stufe (tatsaechliche Kosten, nicht die eigene Zeit).
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  -- Pauschale nach § 288 Abs. 5 BGB, nur gegenueber Unternehmen.
  late_fee_flat NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (late_fee_flat >= 0),
  interest_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),

  -- Die Zinsgrundlagen, eingefroren: Der Basiszinssatz aendert sich jeden
  -- 1. Januar und 1. Juli. Eine heute geschriebene Mahnung muss morgen noch
  -- nachrechenbar sein.
  interest_rate NUMERIC(5,2),
  base_rate NUMERIC(5,2),
  interest_from DATE,
  interest_days INTEGER CHECK (interest_days IS NULL OR interest_days >= 0),

  total_amount NUMERIC(10,2) NOT NULL,

  -- Eingefrorene Parteien, dasselbe Prinzip wie bei Rechnungen: Das Dokument
  -- darf sich nicht aendern, wenn der Kontakt oder die Firma spaeter bearbeitet
  -- wird.
  seller_snapshot JSONB,
  buyer_snapshot JSONB,

  language TEXT NOT NULL DEFAULT 'de',
  intro_text TEXT,
  outro_text TEXT,

  pdf_url TEXT,
  recipient_email TEXT,
  sent_at TIMESTAMPTZ,

  -- Abloesung statt Ueberschreiben: Eine verschickte Mahnung ist ein
  -- Handelsbrief und darf nicht veraendert werden. Eine Korrektur entsteht als
  -- neue Fassung, die auf die alte zeigt — die alte bleibt lesbar und traegt
  -- hier den Verweis auf ihre Nachfolgerin.
  --
  -- ON DELETE SET NULL: Wird eine noch nicht verschickte Korrektur wieder
  -- geloescht, ist die Vorgaengerin automatisch wieder die gueltige Fassung.
  superseded_by UUID REFERENCES payment_reminders(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT payment_reminders_not_self_superseded CHECK (superseded_by IS NULL OR superseded_by <> id),

  -- Die Summe ist immer die Summe ihrer Teile. NUMERIC rechnet exakt, hier
  -- werden also keine Rundungsfehler geduldet, sondern falsch berechnete
  -- Dokumente abgefangen.
  CONSTRAINT payment_reminders_total_is_sum CHECK (
    total_amount = claimed_amount + fee_amount + late_fee_flat + interest_amount
  ),

  -- Was als verschickt gilt, muss sagen wann.
  CONSTRAINT payment_reminders_sent_has_timestamp CHECK (
    status <> 'sent' OR sent_at IS NOT NULL
  )
);

-- Je Rechnung und Stufe darf es nur EINE gueltige Fassung geben; abgeloeste
-- Fassungen bleiben beliebig oft daneben stehen. Dass das keine zwei gueltigen
-- "1. Mahnungen" werden koennen, setzt die Datenbank durch und nicht die
-- Anwendung — zwei gleichzeitige Anfragen kaemen sonst beide durch.
CREATE UNIQUE INDEX idx_payment_reminders_active_stage
  ON payment_reminders (invoice_id, stage_position)
  WHERE superseded_by IS NULL;

CREATE INDEX idx_payment_reminders_company_id ON payment_reminders(company_id);
-- Eigener Index auf invoice_id: Der eindeutige Index oben ist partiell und
-- deckt die Suche nach allen Fassungen einer Rechnung deshalb nicht ab.
CREATE INDEX idx_payment_reminders_invoice_id ON payment_reminders(invoice_id);

ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reminders of their companies"
  ON payment_reminders FOR SELECT
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert reminders for their companies"
  ON payment_reminders FOR INSERT
  WITH CHECK (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update reminders of their companies"
  ON payment_reminders FOR UPDATE
  USING (company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid()));

-- Nur eine noch nicht verschickte Mahnung darf geloescht werden. Was das Haus
-- verlassen hat, gehoert zum Schriftverkehr — dieselbe Begruendung wie bei der
-- Loeschregel fuer Rechnungsentwuerfe in Migration 007.
CREATE POLICY "Users can delete unsent reminders of their companies"
  ON payment_reminders FOR DELETE
  USING (
    status = 'created'
    AND company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
  );

CREATE TRIGGER update_payment_reminders_updated_at BEFORE UPDATE ON payment_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
