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
  -- Zwei verschiedene Tage, die das Mahnschreiben beide braucht und die nur im
  -- Regelfall zusammenfallen.
  --
  -- Der Verzugsbeginn, wie er beim Schreiben der Mahnung galt: der letzte Tag,
  -- an dem noch rechtzeitig gezahlt werden konnte — Verzug besteht ab dem
  -- Folgetag (§ 187 Abs. 1 BGB). Hier steckt der 30-Tage-Boden aus § 286
  -- Abs. 3 BGB drin, deshalb ist das ausdruecklich NICHT die Faelligkeit der
  -- Rechnung: Ein einseitig aufgedrucktes, verkuerztes Zahlungsziel ("zahlbar
  -- innerhalb von 14 Tagen") ist keine kalendermaessige Bestimmung nach § 286
  -- Abs. 2 Nr. 1 und verkuerzt den gesetzlichen Verzugseintritt nicht. Dann
  -- steht hier invoice_date + 30 und in invoice_due_date der 14. Tag.
  --
  -- Eingefroren, weil daran der Zinszeitraum haengt und invoices.due_date
  -- nachtraeglich aenderbar ist. NOT NULL, weil verzugsbeginn() immer einen
  -- Wert liefert oder wirft — ohne Verzugsbeginn gibt es nichts zu mahnen.
  -- Das Schreiben sagt damit: "Sie befinden sich seit dem ... in Verzug."
  default_since DATE NOT NULL,

  -- Die Faelligkeit der Rechnung, wie sie beim Schreiben der Mahnung galt —
  -- roh aus invoices.due_date. Das Schreiben sagt damit: "Rechnung 0042 vom
  -- ..., zahlbar bis ...".
  --
  -- Nullbar, weil eine Rechnung keine Faelligkeit tragen muss (Entwuerfe und
  -- per API angelegte Rechnungen haben nicht zwingend eine). Dann druckt das
  -- Schreiben an dieser Stelle eben nichts. Ein hilfsweise eingesetzter Wert
  -- waere hier schlimmer als die Luecke: er saehe aus wie eine Angabe, die auf
  -- der Rechnung steht, und stuende dort nicht.
  invoice_due_date DATE,

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
  --
  -- Die Wahrheit steht in `interest_segments`, nicht in den Skalaren daneben.
  -- Laeuft eine Forderung ueber einen Satzwechsel hinweg, wird der Zinszeitraum
  -- geteilt, und jedes Teilstueck traegt den damals geltenden Satz — dann gibt
  -- es *einen* Zinssatz schlicht nicht. Ein einzelner Wert koennte nur ein
  -- tagesgewichteter Durchschnitt sein, und der sieht aus wie eine
  -- Feststellung, laesst sich aber nicht nachrechnen: je Abschnitt wird
  -- gerundet, wer mit dem Durchschnitt multipliziert landet neben
  -- `interest_amount`. Genau die Information, die eine Mahnung in drei Jahren
  -- nachvollziehbar macht, ginge dabei still verloren.
  --
  -- Form je Eintrag — eins zu eins InterestSegment aus lib/dunning-interest.ts:
  --   { "from", "to", "days", "baseRate", "ratePercent", "daysInYear",
  --     "amount", "stale" }
  interest_segments JSONB,

  -- Anzeigewerte, und nur dafuer. Traegt der ganze Zeitraum genau einen Satz,
  -- stehen Zinssatz und Basiszinssatz hier und koennen so gedruckt werden
  -- ("9,27 % p. a."). Sonst bleiben beide NULL — eine ehrliche Luecke, die zum
  -- Blick in interest_segments zwingt, ist besser als ein Mittelwert, den
  -- jemand fuer den geltenden Satz haelt.
  interest_rate NUMERIC(5,2),
  base_rate NUMERIC(5,2),
  -- Diese beiden bleiben auch ueber mehrere Abschnitte hinweg eindeutig: der
  -- erste Zinstag ist der erste Zinstag, und die Zinstage addieren sich. Nur
  -- die Saetze tun das nicht.
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
  ),

  -- Ein Objekt oder eine Zahl an dieser Stelle waere eine andere Datenstruktur
  -- als die, die jeder Leser erwartet. Billig zu pruefen, teuer zu entdecken.
  CONSTRAINT payment_reminders_interest_segments_is_array CHECK (
    interest_segments IS NULL OR jsonb_typeof(interest_segments) = 'array'
  ),

  -- Wer Zinsen fordert, muss sagen, wie er sie gerechnet hat. Ein Betrag ohne
  -- Abschnitte waere eine Behauptung ohne Beleg — und genau das Loch, das die
  -- Spalte interest_segments schliessen soll.
  CONSTRAINT payment_reminders_interest_has_segments CHECK (
    interest_amount = 0 OR interest_segments IS NOT NULL
  )
);

COMMENT ON COLUMN payment_reminders.interest_segments IS
  'Zinsabschnitte als JSON-Array (InterestSegment aus lib/dunning-interest.ts). Massgeblich fuer die Nachrechnung; interest_rate/base_rate sind nur Anzeigewerte und bleiben NULL, sobald der Zeitraum mehr als einen Satz traegt.';

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


-- ---------------------------------------------------------------------------
-- 5. Eine Fassung durch die naechste abloesen
-- ---------------------------------------------------------------------------
--
-- Das Problem, das diese Funktion loest, steckt im partiellen eindeutigen
-- Index weiter oben: je (invoice_id, stage_position) darf es nur EINE Zeile
-- mit superseded_by IS NULL geben. Eine Abloesung muss deshalb zwei Zeilen
-- gleichzeitig bewegen — die alte verliert ihre Gueltigkeit, die neue bekommt
-- sie. Naiv geht beides nicht:
--
--   * Die neue Fassung zuerst als gueltig einfuegen: die alte steht noch auf
--     gueltig, der Index schlaegt zu.
--   * Zuerst die alte abloesen: superseded_by zeigt dann auf eine Zeile, die
--     es noch nicht gibt — der Fremdschluessel schlaegt zu.
--
-- Der Ausweg ist ein dritter Zustand, den der Index nicht kennt: Die neue
-- Fassung wird zunaechst *geparkt* eingefuegt, mit superseded_by auf die alte.
-- Sie ist damit selbst nicht gueltig und faellt aus dem partiellen Index
-- heraus; die alte bleibt vorerst die gueltige Fassung. Das Einfuegen erledigt
-- die Anwendung (lib/dunning-service.ts), weil dort die ganze Feldabbildung
-- steht und getestet ist.
--
-- Dann tauscht diese Funktion die Gueltigkeit, und zwar in dieser Reihenfolge:
--
--   1. alt.superseded_by := neu   -> keine Zeile ist gueltig (beide zeigen
--                                    aufeinander; ein Ringverweis, den der
--                                    CHECK ...not_self_superseded erlaubt,
--                                    weil er nur Selbstverweise verbietet)
--   2. neu.superseded_by := NULL  -> genau die neue Zeile ist gueltig
--
-- Nach jedem einzelnen Schritt ist hoechstens eine Zeile gueltig, der Index
-- schlaegt also nie zu. Und weil beide Schritte in einer Funktion stehen,
-- laufen sie in einer Transaktion: den Zwischenzustand ohne gueltige Fassung
-- sieht niemand ausser uns. Genau deshalb muss das hier stehen und kann nicht
-- aus zwei PostgREST-Aufrufen bestehen — zwei Aufrufe sind zwei Transaktionen,
-- und zwischen ihnen haette die Rechnung voruebergehend gar keine gueltige
-- Mahnung dieser Stufe. Die Stufenermittlung wuerde die Stufe dann erneut
-- anbieten und die 40-Euro-Pauschale falsch zaehlen.
--
-- Bricht umgekehrt schon das Einfuegen ab oder scheitert dieser Aufruf, bleibt
-- nur die geparkte Zeile uebrig: unsichtbar fuer die Stufenermittlung, von der
-- Anwendung wieder loeschbar, und die alte Fassung ist unveraendert gueltig.
-- Ein Fehler faellt also in die harmlose Richtung.
--
-- SECURITY INVOKER (der Standardfall, hier ausdruecklich hingeschrieben): Beide
-- UPDATEs gehen durch die Zugriffsregeln der Tabelle, eine eigene
-- Firmenpruefung im Rumpf waere ueberfluessig und eine zweite Wahrheit.
--
-- tests/dunning-service.test.ts bildet den Index nach und prueft diese
-- Reihenfolge — samt Gegenprobe mit der naiven Reihenfolge.
CREATE OR REPLACE FUNCTION supersede_payment_reminder(
  p_old_id UUID,
  p_new_id UUID
)
RETURNS SETOF payment_reminders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old payment_reminders;
  v_new payment_reminders;
BEGIN
  IF p_old_id = p_new_id THEN
    RAISE EXCEPTION 'Eine Mahnung kann sich nicht selbst abloesen (%)', p_old_id
      USING ERRCODE = '22023';
  END IF;

  -- Beide Zeilen sperren, bevor irgendetwas geschrieben wird. Zwei gleichzeitige
  -- Abloesungen derselben Fassung sollen sich nacheinander anstellen; die
  -- zweite findet die alte Fassung dann bereits abgeloest vor und bricht ab,
  -- statt eine zweite Nachfolgerin zu erzeugen.
  SELECT * INTO v_old FROM payment_reminders WHERE id = p_old_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Abzuloesende Mahnung % nicht gefunden', p_old_id
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_new FROM payment_reminders WHERE id = p_new_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Neue Fassung % nicht gefunden', p_new_id
      USING ERRCODE = '22023';
  END IF;

  IF v_old.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'Mahnung % wurde bereits abgeloest', p_old_id
      USING ERRCODE = '23505';
  END IF;

  -- Die neue Fassung muss geparkt ankommen, sonst waere sie schon beim
  -- Einfuegen am Index gescheitert und wir reden ueber eine fremde Zeile.
  IF v_new.superseded_by IS DISTINCT FROM p_old_id THEN
    RAISE EXCEPTION 'Neue Fassung % ist nicht auf % geparkt', p_new_id, p_old_id
      USING ERRCODE = '22023';
  END IF;

  -- Abgeloest wird nur innerhalb derselben Rechnung und derselben Stufe. Eine
  -- "1. Mahnung", die eine "Letzte Mahnung" abloest, waere keine Korrektur,
  -- sondern ein Loch in der Eskalation.
  IF v_new.invoice_id <> v_old.invoice_id
     OR v_new.stage_position <> v_old.stage_position THEN
    RAISE EXCEPTION 'Abloesung nur innerhalb derselben Rechnung und Stufe moeglich'
      USING ERRCODE = '22023';
  END IF;

  UPDATE payment_reminders SET superseded_by = p_new_id WHERE id = p_old_id;
  UPDATE payment_reminders SET superseded_by = NULL     WHERE id = p_new_id;

  RETURN QUERY SELECT * FROM payment_reminders WHERE id = p_new_id;
END;
$$;

REVOKE ALL ON FUNCTION supersede_payment_reminder(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION supersede_payment_reminder(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION supersede_payment_reminder(UUID, UUID) TO authenticated;
