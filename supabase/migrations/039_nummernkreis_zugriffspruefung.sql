-- Zugriffspruefung fuer die Nummernkreis-Funktionen.
--
-- Beide Funktionen laufen als SECURITY DEFINER und umgehen damit saemtliche
-- Zugriffsregeln. Sie sind ausserdem per GRANT fuer jeden angemeldeten Nutzer
-- aufrufbar — und Supabase stellt Funktionen ueber PostgREST direkt bereit.
--
-- Bisher pruefte der Rumpf nicht, ob der Aufrufer zu der uebergebenen Firma
-- gehoert. Die Pruefung in lib/invoice-service.ts (assertCompanyMembership)
-- schuetzt deshalb nur den Weg durch die eigene API; wer die Funktion direkt
-- mit seinem eigenen Token aufruft, geht daran vorbei und kann den
-- Nummernzaehler einer fremden Firma hochdrehen. Der Schaden sind Luecken im
-- Nummernkreis — und gerade deren Lueckenlosigkeit verlangt die GoBD.
--
-- Zwei Dinge sind beim Fix zu beachten:
--
-- 1. Die oeffentliche API (app/api/v1/...) arbeitet mit
--    createServiceRoleClient(); dort ist auth.uid() leer. Sie wird bereits in
--    app/api/v1/_lib/auth.ts gegen den API-Schluessel geprueft. Die Pruefung
--    hier greift deshalb nur, wenn ueberhaupt ein Nutzerkontext vorhanden ist.
--    Ein anonymes Token kann die Funktionen gar nicht erst aufrufen — der
--    GRANT gilt nur fuer 'authenticated'.
--
-- 2. Beim Verkaeufertyp 'contact' ist die uebergebene ID ein Kontakt, nicht
--    die Firma. Geprueft wird die Firma, zu der der Kontakt gehoert.
--
-- Die Pruefung steht vor dem UPDATE: Eine Ausnahme wuerde die Transaktion
-- zwar ohnehin zuruecknehmen, aber so entsteht erst gar keine Sperre auf der
-- fremden Zeile.
--
-- Signaturen und Rueckgabespalten bleiben unveraendert (next_number,
-- formatted_number), damit CREATE OR REPLACE greift. Die Formatierung des
-- Praefixes aus Migration 038 ist Zeichen fuer Zeichen uebernommen.
--
-- Zusaetzlich wird search_path festgenagelt. Ohne das kann der Aufrufer bei
-- einer SECURITY-DEFINER-Funktion bestimmen, aus welchem Schema die
-- referenzierten Tabellen kommen.

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
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM company_users cu
    WHERE cu.user_id = auth.uid()
      AND cu.company_id = v_company_id
  ) THEN
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

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM company_users cu
    WHERE cu.user_id = auth.uid()
      AND cu.company_id = v_company_id
  ) THEN
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

-- Unveraendert: Der Aufruf bleibt angemeldeten Nutzern erlaubt, die Pruefung
-- steckt jetzt im Rumpf. 'anon' bekommt bewusst kein Recht.
GRANT EXECUTE ON FUNCTION get_next_invoice_number(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_cancellation_invoice_number(TEXT, UUID, TEXT) TO authenticated;
