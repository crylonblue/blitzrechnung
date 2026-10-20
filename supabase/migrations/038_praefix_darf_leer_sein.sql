-- Rechnungsnummern ohne Praefix ermoeglichen.
--
-- Bisher hing der Trenner unbedingt an der Nummer:
--   COALESCE(v_prefix, 'INV') || '-' || LPAD(...)
-- Ein leeres Praefix ergab damit "-0001", ein fehlendes "INV-0001". Ein
-- blosses "0001" war nicht erreichbar. Wer einen bestehenden Nummernkreis
-- fortfuehren will, konnte das also nicht abbilden — und das Eingabefeld in
-- den Einstellungen nahm die Leerung entgegen, ohne dass sie wirkte.
--
-- Neu: Der Trenner erscheint nur, wenn ein Praefix vorhanden ist.
--
-- Bestehende Nummernkreise bleiben Zeichen fuer Zeichen gleich: Wer ein
-- Praefix hinterlegt hat, bekommt weiterhin "INV-0001". Nur der bisher
-- unerreichbare Fall "kein Praefix" verhaelt sich jetzt sinnvoll.
--
-- Die Signaturen bleiben unveraendert (next_number, formatted_number), damit
-- CREATE OR REPLACE greift und die aufrufenden Routen nichts merken.

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
AS $$
DECLARE
  v_counter INTEGER;
  v_prefix TEXT;
BEGIN
  IF p_seller_type = 'company' THEN
    UPDATE companies
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Company not found: %', p_seller_id;
    END IF;

  ELSIF p_seller_type = 'contact' THEN
    UPDATE contacts
    SET invoice_number_counter = invoice_number_counter + 1
    WHERE id = p_seller_id
    RETURNING invoice_number_counter, invoice_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Invalid seller_type: %. Must be "company" or "contact"', p_seller_type;
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
AS $$
DECLARE
  v_counter INTEGER;
  v_prefix TEXT;
BEGIN
  IF p_seller_type = 'company' THEN
    UPDATE companies
    SET cancellation_number_counter = COALESCE(cancellation_number_counter, 0) + 1
    WHERE id = p_seller_id
    RETURNING cancellation_number_counter, cancellation_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Company not found: %', p_seller_id;
    END IF;

  ELSIF p_seller_type = 'contact' THEN
    UPDATE contacts
    SET cancellation_number_counter = COALESCE(cancellation_number_counter, 0) + 1
    WHERE id = p_seller_id
    RETURNING cancellation_number_counter, cancellation_number_prefix
    INTO v_counter, v_prefix;

    IF v_counter IS NULL THEN
      RAISE EXCEPTION 'Contact not found: %', p_seller_id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Invalid seller_type: %. Must be "company" or "contact"', p_seller_type;
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
