-- Der Profilname darf nicht die E-Mail-Adresse sein.
--
-- handle_new_user() aus 001 setzte den Namen auf
--   COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
-- Bei einer Registrierung mit E-Mail und Passwort gibt es kein 'full_name' —
-- der Name wurde also buchstaeblich die Adresse. In der Seitenleiste stand sie
-- dadurch zweimal untereinander, und jede Pruefung auf "kein Name hinterlegt"
-- lief ins Leere, weil das Feld ja gefuellt war.
--
-- Richtig ist NULL: "unbekannt" ist eine Angabe, eine wiederholte Adresse ist
-- eine Behauptung. Erst damit kann die Oberflaeche den Unterschied sehen, und
-- erst damit zeigt ein spaeteres Namensfeld im Onboarding eine echte Aenderung.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, name, auth_provider)
  VALUES (
    NEW.id,
    NEW.email,
    -- NULLIF faengt zusaetzlich den Leerstring ab, den manche Anmeldedienste
    -- statt eines fehlenden Feldes liefern.
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''),
    COALESCE(NEW.raw_user_meta_data->>'provider', 'email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Bestand nachziehen: Wo der Name nichts anderes sagt als die Adresse, ist er
-- keine Angabe. Echte Namen bleiben unberuehrt; dass jemand seine Adresse
-- bewusst als Anzeigenamen gewaehlt hat, ist bei dieser Herkunft praktisch
-- ausgeschlossen -- das Feld wurde nie zur Eingabe angeboten.
UPDATE public.user_profiles
SET name = NULL
WHERE name IS NOT NULL
  AND btrim(name) = btrim(email);

-- Leerstrings, falls welche vorliegen, bedeuten dasselbe wie NULL.
UPDATE public.user_profiles
SET name = NULL
WHERE name IS NOT NULL
  AND btrim(name) = '';
