-- Mehrere Nutzer je Firma mit Rollen, und Rechnungen je Abteilung.
--
-- Bisher sah jedes Mitglied einer Firma alles, was die Firma hat. Jetzt gilt:
--
--   company_users.role     owner | admin | accountant | member
--   department_members.role manager | member
--
--   owner, admin   sehen und aendern alle Rechnungen der Firma
--   accountant     sieht alle Rechnungen, aendert keine
--   member         sieht und aendert nur Rechnungen der eigenen Abteilungen;
--                  als Abteilungs-Manager verwaltet er zusaetzlich deren Mitglieder
--
-- Abteilungs-Manager ist bewusst keine Firmenrolle, sondern die Rolle in der
-- Abteilung: Wer eine Abteilung leitet, kann in einer anderen einfaches
-- Mitglied sein. Zwei Quellen fuer dieselbe Aussage gaebe es sonst.
--
-- Kontakte, Produkte und Einstellungen bleiben firmenweit.
--
-- Die Pruefungen stehen als SECURITY DEFINER-Funktionen hier, weil dieselbe
-- Abfrage innerhalb einer Policy auf company_users wieder die Policy ausloeste
-- (siehe 002). Der Dienstschluessel umgeht RLS; fuer diese Pfade pruefen die
-- Routen in lib/access.ts.

-- ---------------------------------------------------------------------------
-- Rollen
-- ---------------------------------------------------------------------------

ALTER TABLE company_users
  ADD CONSTRAINT company_users_role_check
  CHECK (role IN ('owner', 'admin', 'accountant', 'member'));

-- ---------------------------------------------------------------------------
-- Abteilungen
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  -- Auffangbecken fuer Rechnungen ohne ausdrueckliche Abteilung (API, Altbestand).
  -- Hoechstens eine je Firma, siehe Index unten.
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_departments_one_default_per_company
  ON departments(company_id) WHERE is_default;
CREATE UNIQUE INDEX idx_departments_name_per_company
  ON departments(company_id, lower(btrim(name)));
CREATE INDEX idx_departments_company_id ON departments(company_id);

CREATE TABLE department_members (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (department_id, user_id)
);

CREATE INDEX idx_department_members_user_id ON department_members(user_id);

-- Zunächst ohne NOT NULL; der Bestand wird weiter unten nachgezogen. Die Spalte muss
-- vor den Hilfsfunktionen existieren, die sie lesen.
ALTER TABLE invoices ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE RESTRICT;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Einladungen
-- ---------------------------------------------------------------------------

-- Wer eingeladen wird, bekommt das Konto samt Mitgliedschaft sofort. Bis zur
-- ersten Anmeldung per Link oder Code steht die Person im Team als
-- "eingeladen". Eine eigene Einladungstabelle samt Token braucht es dafuer
-- nicht: Der Anmelde-Token entsteht erst beim Versand der Mail.
ALTER TABLE company_users ADD COLUMN invite_pending BOOLEAN NOT NULL DEFAULT false;

-- Bremse fuer den Mailversand der Anmeldung (ein Code je Adresse und Minute).
-- Nur der Dienstschluessel liest und schreibt hier; RLS ohne Policy sperrt alle anderen.
CREATE TABLE login_requests (
  email TEXT PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE login_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION company_role(p_company_id UUID)
RETURNS TEXT AS $$
  SELECT cu.role
  FROM company_users cu
  WHERE cu.company_id = p_company_id
    AND cu.user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_company_admin(p_company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(company_role(p_company_id) IN ('owner', 'admin'), false)
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_department_member(p_department_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM department_members dm
    WHERE dm.department_id = p_department_id
      AND dm.user_id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION is_department_manager(p_department_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM department_members dm
    WHERE dm.department_id = p_department_id
      AND dm.user_id = auth.uid()
      AND dm.role = 'manager'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Darf der Nutzer die Rechnung einer Abteilung sehen?
CREATE OR REPLACE FUNCTION can_read_invoice(p_company_id UUID, p_department_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT := company_role(p_company_id);
BEGIN
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_role IN ('owner', 'admin', 'accountant') THEN
    RETURN true;
  END IF;
  RETURN p_department_id IS NOT NULL AND is_department_member(p_department_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Darf der Nutzer Rechnungen einer Abteilung anlegen, aendern, loeschen?
-- Die Abteilung muss zur Firma gehoeren; sonst liesse sich eine fremde
-- Abteilungs-ID an eine Rechnung heften.
CREATE OR REPLACE FUNCTION can_write_invoice(p_company_id UUID, p_department_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT := company_role(p_company_id);
BEGIN
  IF v_role IS NULL OR v_role = 'accountant' THEN
    RETURN false;
  END IF;
  IF p_department_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.id = p_department_id AND d.company_id = p_company_id
  ) THEN
    RETURN false;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;
  RETURN is_department_member(p_department_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Fuer Tabellen, die an einer Rechnung haengen (Mahnungen).
CREATE OR REPLACE FUNCTION can_read_invoice_id(p_invoice_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT can_read_invoice(i.company_id, i.department_id)
     FROM invoices i WHERE i.id = p_invoice_id),
    false)
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION can_write_invoice_id(p_invoice_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT can_write_invoice(i.company_id, i.department_id)
     FROM invoices i WHERE i.id = p_invoice_id),
    false)
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Nur Mitglieder der Firma duerfen in eine ihrer Abteilungen; sonst koennte ein
-- Abteilungs-Manager beliebige Konten aufnehmen. Gilt auch fuer den Dienstschluessel.
CREATE OR REPLACE FUNCTION department_members_same_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM departments d
    JOIN company_users cu ON cu.company_id = d.company_id
    WHERE d.id = NEW.department_id AND cu.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Nutzer gehoert nicht zur Firma der Abteilung'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER department_members_same_company
  BEFORE INSERT OR UPDATE OF department_id, user_id ON department_members
  FOR EACH ROW EXECUTE FUNCTION department_members_same_company();

-- ---------------------------------------------------------------------------
-- Rechnungen: Abteilung
-- ---------------------------------------------------------------------------

-- Jede Firma bekommt eine Standardabteilung, auch kuenftige.
INSERT INTO departments (company_id, name, is_default)
SELECT id, 'Allgemein', true FROM companies;

CREATE OR REPLACE FUNCTION create_default_department()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO departments (company_id, name, is_default)
  VALUES (NEW.id, 'Allgemein', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER companies_create_default_department
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION create_default_department();

-- Bestand: alle Rechnungen in die Standardabteilung, alle bisherigen
-- Mitglieder dort aufnehmen — sonst saehen sie nach dieser Migration nichts
-- mehr. Eigentuemer sehen ohnehin alles.
-- updated_at bleibt unberuehrt: Die Zuordnung aendert nichts am Inhalt, und bei
-- festgeschriebenen Rechnungen soll der echte Aenderungszeitpunkt erhalten bleiben.
ALTER TABLE invoices DISABLE TRIGGER update_invoices_updated_at;
UPDATE invoices i
SET department_id = d.id
FROM departments d
WHERE d.company_id = i.company_id AND d.is_default;
ALTER TABLE invoices ENABLE TRIGGER update_invoices_updated_at;

INSERT INTO department_members (department_id, user_id, role)
SELECT d.id, cu.user_id, 'member'
FROM company_users cu
JOIN departments d ON d.company_id = cu.company_id AND d.is_default
WHERE cu.role = 'member';

ALTER TABLE invoices ALTER COLUMN department_id SET NOT NULL;
CREATE INDEX idx_invoices_department_id ON invoices(department_id);

-- Ohne ausdrueckliche Abteilung (oeffentliche API, aeltere Aufrufer) landet die
-- Rechnung in der Standardabteilung. Laeuft vor der NOT NULL-Pruefung.
CREATE OR REPLACE FUNCTION invoices_default_department()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.department_id IS NULL THEN
    SELECT d.id INTO NEW.department_id
    FROM departments d
    WHERE d.company_id = NEW.company_id AND d.is_default;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER invoices_default_department
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_default_department();

-- ---------------------------------------------------------------------------
-- Policies: Rechnungen
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Users can insert invoices for their companies" ON invoices;
DROP POLICY IF EXISTS "Users can update invoices of their companies" ON invoices;
DROP POLICY IF EXISTS "Users can delete draft invoices of their companies" ON invoices;

CREATE POLICY "Users can view invoices of their departments"
  ON invoices FOR SELECT
  USING (can_read_invoice(company_id, department_id));

CREATE POLICY "Users can insert invoices into their departments"
  ON invoices FOR INSERT
  WITH CHECK (can_write_invoice(company_id, department_id));

CREATE POLICY "Users can update invoices of their departments"
  ON invoices FOR UPDATE
  USING (can_write_invoice(company_id, department_id))
  WITH CHECK (can_write_invoice(company_id, department_id));

CREATE POLICY "Users can delete draft invoices of their departments"
  ON invoices FOR DELETE
  USING (status = 'draft' AND can_write_invoice(company_id, department_id));

-- ---------------------------------------------------------------------------
-- Policies: Mahnungen folgen der Rechnung
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view reminders of their companies" ON payment_reminders;
DROP POLICY IF EXISTS "Users can insert reminders for their companies" ON payment_reminders;
DROP POLICY IF EXISTS "Users can update reminders of their companies" ON payment_reminders;
DROP POLICY IF EXISTS "Users can delete unsent reminders of their companies" ON payment_reminders;

CREATE POLICY "Users can view reminders of their invoices"
  ON payment_reminders FOR SELECT
  USING (can_read_invoice_id(invoice_id));

CREATE POLICY "Users can insert reminders for their invoices"
  ON payment_reminders FOR INSERT
  WITH CHECK (can_write_invoice_id(invoice_id));

CREATE POLICY "Users can update reminders of their invoices"
  ON payment_reminders FOR UPDATE
  USING (can_write_invoice_id(invoice_id))
  WITH CHECK (can_write_invoice_id(invoice_id));

CREATE POLICY "Users can delete unsent reminders of their invoices"
  ON payment_reminders FOR DELETE
  USING (status = 'created' AND can_write_invoice_id(invoice_id));

-- ---------------------------------------------------------------------------
-- Policies: Abteilungen, Mitglieder, Einladungen
-- ---------------------------------------------------------------------------

-- Jedes Firmenmitglied sieht die Abteilungsnamen (fuer Auswahl und Filter).
CREATE POLICY "Members can view departments of their companies"
  ON departments FOR SELECT
  USING (company_id = ANY(SELECT get_user_company_ids()));

CREATE POLICY "Admins can insert departments"
  ON departments FOR INSERT
  WITH CHECK (is_company_admin(company_id));

CREATE POLICY "Admins can update departments"
  ON departments FOR UPDATE
  USING (is_company_admin(company_id))
  WITH CHECK (is_company_admin(company_id));

CREATE POLICY "Admins can delete departments"
  ON departments FOR DELETE
  USING (is_company_admin(company_id) AND NOT is_default);

CREATE POLICY "Users can view department memberships"
  ON department_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR is_department_manager(department_id)
    OR is_company_admin((SELECT d.company_id FROM departments d WHERE d.id = department_id))
  );

CREATE POLICY "Managers can add department members"
  ON department_members FOR INSERT
  WITH CHECK (
    is_department_manager(department_id)
    OR is_company_admin((SELECT d.company_id FROM departments d WHERE d.id = department_id))
  );

CREATE POLICY "Managers can update department members"
  ON department_members FOR UPDATE
  USING (
    is_department_manager(department_id)
    OR is_company_admin((SELECT d.company_id FROM departments d WHERE d.id = department_id))
  );

CREATE POLICY "Managers can remove department members"
  ON department_members FOR DELETE
  USING (
    is_department_manager(department_id)
    OR is_company_admin((SELECT d.company_id FROM departments d WHERE d.id = department_id))
  );


-- Nummernkreis: Die RPCs sind SECURITY DEFINER und fuer `authenticated`
-- freigegeben. Bisher genuegte die Firmenzugehoerigkeit; ein Accountant oder
-- ein Mitglied ohne Abteilung konnte so ueber PostgREST Nummern verbrauchen und
-- Luecken im Nummernkreis reissen. Wer keine Rechnung schreiben darf, darf auch
-- keine Nummer ziehen. (Die Abteilung der Rechnung kennt die Funktion nicht;
-- die genaue Pruefung macht lib/invoice-service.ts vor dem Aufruf.)
CREATE OR REPLACE FUNCTION can_issue_invoice_numbers(p_company_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT := company_role(p_company_id);
BEGIN
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;
  IF v_role <> 'member' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM department_members dm
    JOIN departments d ON d.id = dm.department_id
    WHERE dm.user_id = auth.uid() AND d.company_id = p_company_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Neufassung der Nummernfunktionen aus 039; einzige Aenderung ist die Pruefung.
CREATE OR REPLACE FUNCTION get_next_invoice_number(
  p_seller_type TEXT,  -- 'company' oder 'contact'
  p_seller_id UUID,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TABLE (
  next_number INTEGER,
  formatted_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_counter INTEGER;
  v_prefix TEXT;
  v_company_id UUID;
BEGIN
  -- Zuerst die Firma bestimmen, zu der die Nummer gehoert.
  IF p_seller_type = 'company' THEN
    v_company_id := p_seller_id;

  ELSIF p_seller_type = 'contact' THEN
    SELECT c.company_id INTO v_company_id
    FROM contacts c
    WHERE c.id = p_seller_id;

    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Invalid seller_type: %. Must be "company" or "contact"', p_seller_type;
  END IF;

  -- Ohne Nutzerkontext (Dienstschluessel der oeffentlichen API) entfaellt die
  -- Pruefung hier; dort traegt der API-Schluessel die Autorisierung.
  IF auth.uid() IS NOT NULL AND NOT can_issue_invoice_numbers(v_company_id) THEN
    RAISE EXCEPTION 'Kein Zugriff auf die Firma %', v_company_id
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_type = 'company' THEN
    UPDATE companies
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Company not found: %', p_seller_id;
    END IF;

  ELSE
    UPDATE contacts
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;
  END IF;

  -- Ein ausdruecklich uebergebenes Praefix gewinnt, sonst gilt das hinterlegte.
  -- Der Leerstring ist hier eine gueltige Angabe und bedeutet "kein Praefix";
  -- deshalb wird auf IS NOT NULL geprueft, nicht auf Wahrheitswert.
  IF p_prefix IS NOT NULL THEN
    v_prefix := p_prefix;
  END IF;

  next_number := v_counter;

  -- Kein Praefix, kein Trenner.
  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    formatted_number := LPAD(v_counter::TEXT, 4, '0');
  ELSE
    formatted_number := btrim(v_prefix) || '-' || LPAD(v_counter::TEXT, 4, '0');
  END IF;

  RETURN NEXT;
END;
$$;

-- Dieselbe Behandlung fuer Stornorechnungen, damit beide Nummernkreise sich
-- gleich verhalten.
CREATE OR REPLACE FUNCTION get_next_cancellation_invoice_number(
  p_seller_type TEXT,
  p_seller_id UUID,
  p_prefix TEXT DEFAULT NULL
)
RETURNS TABLE (
  next_number INTEGER,
  formatted_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_counter INTEGER;
  v_prefix TEXT;
  v_company_id UUID;
BEGIN
  IF p_seller_type = 'company' THEN
    v_company_id := p_seller_id;

  ELSIF p_seller_type = 'contact' THEN
    SELECT c.company_id INTO v_company_id
    FROM contacts c
    WHERE c.id = p_seller_id;

    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Invalid seller_type: %. Must be "company" or "contact"', p_seller_type;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT can_issue_invoice_numbers(v_company_id) THEN
    RAISE EXCEPTION 'Kein Zugriff auf die Firma %', v_company_id
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_type = 'company' THEN
    UPDATE companies
    SET cancellation_number_counter = COALESCE(cancellation_number_counter, 0) + 1
    WHERE id = p_seller_id
    RETURNING cancellation_number_counter, cancellation_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Company not found: %', p_seller_id;
    END IF;

  ELSE
    UPDATE contacts
    SET cancellation_number_counter = COALESCE(cancellation_number_counter, 0) + 1
    WHERE id = p_seller_id
    RETURNING cancellation_number_counter, cancellation_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;
  END IF;

  IF p_prefix IS NOT NULL THEN
    v_prefix := p_prefix;
  END IF;

  next_number := v_counter;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    formatted_number := LPAD(v_counter::TEXT, 4, '0');
  ELSE
    formatted_number := btrim(v_prefix) || '-' || LPAD(v_counter::TEXT, 4, '0');
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_next_invoice_number(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_cancellation_invoice_number(TEXT, UUID, TEXT) TO authenticated;
