-- Beispieldaten fuer die lokale Entwicklung.
--
-- Diese Datei wird von `supabase db reset` nach allen Migrationen eingespielt
-- (siehe [db.seed] in supabase/config.toml) und laeuft ausschliesslich lokal.
-- In die Produktion kommt sie nie: dort gibt es weder einen Seed-Lauf noch
-- einen Grund, ein Konto mit bekanntem Passwort anzulegen.
--
-- Warum es sie gibt: Nach einem Reset war die Datenbank leer, und wer eine
-- Kleinigkeit am Mahnwesen oder an der Belegliste pruefen wollte, musste sich
-- erst durch Registrierung, Onboarding, Kontaktanlage und Rechnungserstellung
-- arbeiten. Das kostet jedes Mal zehn Minuten und erzeugt dabei Daten, die
-- sich von Lauf zu Lauf unterscheiden — Fehler, die nur bei einer ueberfaelligen
-- Rechnung mit verkuerztem Zahlungsziel auftreten, findet so niemand zweimal.
--
-- Zugang:  hello@till.email  /  blitz1234
--
-- Zwei Regeln, an die sich alles hier haelt:
--
--  1. **Alles relativ zu current_date.** Ein fest eingetragenes
--     "2026-09-01" waere in drei Monaten keine "ueberfaellige Rechnung" mehr,
--     sondern eine sehr alte — der Seed wuerde still altern und genau den
--     Fall nicht mehr zeigen, fuer den er da ist.
--  2. **Feste UUIDs fuer alle Hauptobjekte.** Beim Debuggen soll man eine ID
--     im Log wiedererkennen, statt sie jedes Mal neu nachzuschlagen.
--
-- Wiederholt ausfuehrbar: Der Block ganz oben raeumt die eigenen Zeilen weg,
-- bevor neu angelegt wird. Ein zweiter Lauf scheitert deshalb nicht an
-- doppelten Schluesseln.


-- ===========================================================================
-- 0. Aufraeumen
-- ===========================================================================
--
-- Nur die eigenen festen IDs, nichts anderes: Wer lokal nebenher ein zweites
-- Konto angelegt hat, soll es nicht durch einen Seed-Lauf verlieren.
--
-- Zwei DELETEs genuegen, der Rest haengt an ON DELETE CASCADE:
-- auth.users -> user_profiles -> company_users, und
-- companies -> contacts, invoices, payment_reminders, products, subscriptions.
DELETE FROM public.companies WHERE id = '22222222-2222-2222-2222-222222222222';
DELETE FROM auth.users       WHERE id = '11111111-1111-1111-1111-111111111111';


-- ===========================================================================
-- 1. Das Anmeldekonto
-- ===========================================================================
--
-- GoTrue liest diese Zeile beim Passwort-Login. Gesetzt werden muss mehr als
-- nur E-Mail und Passwort:
--
--  * `instance_id`, `aud` und `role` sucht GoTrue beim Nachschlagen des
--    Nutzers mit ab; fehlen sie, wird das Konto schlicht nicht gefunden.
--  * `email_confirmed_at` muss gesetzt sein, sonst verlangt GoTrue die
--    Bestaetigungsmail — lokal landet die in Mailpit und niemand will sie
--    nach jedem Reset heraussuchen.
--  * Die Token-Spalten bekommen den Leerstring statt NULL. GoTrue liest sie
--    in Zeichenketten ein; ein NULL laesst manche Fassungen beim Login
--    abbrechen, und ein Leerstring kollidiert mit keinem der partiellen
--    Eindeutigkeitsindizes (die greifen nur bei Token, die nicht nur aus
--    Ziffern und Leerzeichen bestehen).
--
-- Das Passwort wird mit bcrypt gehasht, genau wie GoTrue es selbst tut —
-- `crypt()` und `gen_salt()` kommen aus pgcrypto, das Supabase ohnehin
-- installiert.
--
-- `raw_user_meta_data.full_name` ist kein Schmuck: Der Trigger
-- `handle_new_user` (Migration 001, geaendert in 041) legt das Profil in
-- public.user_profiles selbst an und nimmt den Namen von dort. Ohne das Feld
-- bliebe der Name NULL — richtig fuer eine echte Registrierung, aber hier
-- haetten wir dann ein Konto ohne Anzeigenamen. Deshalb steht der Name hier
-- und NICHT als zweites INSERT in user_profiles: das waere eine Doppelanlage
-- und scheiterte am Primaerschluessel.
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'hello@till.email',
  crypt('blitz1234', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Till Kemper", "provider": "email"}'::jsonb,
  now() - interval '30 days',
  now(),
  '', '', '', '', '', ''
);

-- Die Identitaet zum Konto. Beim Passwort-Login wird sie nicht zwingend
-- gelesen, aber alles, was Identitaeten auflistet (Kontoeinstellungen,
-- "Verknuepfte Anmeldungen"), zeigt sonst ein Konto ohne jede Anmeldeart.
-- `provider_id` ist bei der E-Mail-Anmeldung die Nutzer-ID.
INSERT INTO auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub": "11111111-1111-1111-1111-111111111111", "email": "hello@till.email", "email_verified": true, "phone_verified": false}'::jsonb,
  'email',
  now(),
  now() - interval '30 days',
  now()
);


-- ===========================================================================
-- 2. Die Firma
-- ===========================================================================
--
-- Vollstaendig genug, dass sich eine Rechnung sofort fertigstellen laesst.
-- Was `lib/invoice-validation.ts` beim Fertigstellen verlangt, steht
-- vollzaehlig hier: Name, Adresse mit Hausnummer, Steuernummer ODER
-- USt-IdNr. (hier beides), IBAN und eine Kontakt-E-Mail (BT-34, ohne die
-- keine E-Rechnung). Fehlte eines davon, meldete die Oberflaeche "Zum
-- Fertigstellen fehlt noch ..." — und genau das soll beim Durchklicken nicht
-- passieren.
--
-- `trial_ends_at` liegt bewusst neun Tage in der Zukunft: Die Testphase
-- schaltet das Fertigstellen frei (lib/billing.ts) und laesst zugleich das
-- Hinweisbanner auf dem Dashboard sehen. Eine abgelaufene Testphase waere
-- auch ein interessanter Fall — aber nicht der, den man beim Durchklicken
-- als Erstes braucht.
--
-- Die Zaehler stehen auf den Staenden, die zu den unten vergebenen Nummern
-- passen: fuenf Rechnungen RE-0001..RE-0005 und eine Stornorechnung ST-0001.
-- Stimmten sie nicht, vergaebe die naechste echte Rechnung eine bereits
-- benutzte Nummer und liefe in den eindeutigen Index aus Migration 029.
INSERT INTO public.companies (
  id,
  name,
  address,
  country,
  vat_id,
  tax_id,
  invoice_number_prefix,
  invoice_number_format,
  invoice_number_counter,
  cancellation_number_prefix,
  cancellation_number_counter,
  default_vat_rate,
  bank_details,
  accounting_email,
  contact_name,
  contact_phone,
  contact_email,
  additional_contacts,
  court,
  register_number,
  managing_director,
  default_intro_text,
  default_outro_text,
  trial_ends_at,
  created_at
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Blitz Digitalwerk GmbH',
  '{"street": "Hafenstraße", "streetnumber": "12", "zip": "20359", "city": "Hamburg", "country": "DE"}'::jsonb,
  'DE',
  'DE327654981',
  '22/815/04231',
  'RE',
  '{prefix}-{number}',
  5,
  'ST',
  1,
  19.00,
  '{"bank_name": "Hamburger Sparkasse", "iban": "DE02200505501015871393", "bic": "HASPDEHHXXX", "account_holder": "Blitz Digitalwerk GmbH"}'::jsonb,
  'buchhaltung@blitz-digitalwerk.example',
  'Till Kemper',
  '+49 40 123456-0',
  'rechnung@blitz-digitalwerk.example',
  -- Ein zweiter Ansprechpartner, damit die Auswahl im Rechnungseditor nicht
  -- leer ist. Die ID ist frei waehlbar; sie landet in
  -- invoices.contact_person_id (siehe lib/contact-persons.ts).
  '[{"id": "ap-projekte", "name": "Mira Falk", "phone": "+49 40 123456-24", "email": "projekte@blitz-digitalwerk.example"}]'::jsonb,
  'Amtsgericht Hamburg',
  'HRB 123456',
  'Till Kemper',
  'vielen Dank für die gute Zusammenarbeit. Nachstehend stellen wir Ihnen die vereinbarten Leistungen in Rechnung.',
  'Bitte überweisen Sie den Betrag ohne Abzug auf das unten genannte Konto.',
  now() + interval '9 days',
  now() - interval '30 days'
);

INSERT INTO public.company_users (id, user_id, company_id, role, created_at)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'owner',
  now() - interval '30 days'
);

-- Kein Eintrag in `subscriptions`: Ohne Zeile gilt die Testphase aus
-- companies.trial_ends_at, und die gibt nach lib/billing.ts den vollen
-- Pro-Umfang frei. Eine erfundene Stripe-Zeile waere nur eine zweite
-- Wahrheit, die beim ersten echten Webhook auseinanderliefe.
--
-- Ebenso bleibt `dunning_stages` leer. Das ist Absicht und kein Versaeumnis:
-- Hat eine Firma keine eigenen Stufen, gilt der Standardsatz aus
-- lib/dunning-stages.ts (Zahlungserinnerung, 1. Mahnung, Letzte Mahnung).
-- Genau dieser Weg soll lokal der normale sein.


-- ===========================================================================
-- 3. Artikel
-- ===========================================================================
--
-- Damit die Positionsauswahl im Editor etwas anzubieten hat.
INSERT INTO public.products (id, company_id, name, description, unit, unit_price, default_vat_rate) VALUES
  ('77777777-7777-7777-7777-777777777701', '22222222-2222-2222-2222-222222222222',
   'Konzeption & Entwicklung', 'Stundensatz für Konzeption, Umsetzung und Abnahme', 'hour', 95.00, 19.00),
  ('77777777-7777-7777-7777-777777777702', '22222222-2222-2222-2222-222222222222',
   'Serverbetreuung', 'Monatspauschale für Betrieb, Updates und Monitoring', 'month', 1200.00, 19.00),
  ('77777777-7777-7777-7777-777777777703', '22222222-2222-2222-2222-222222222222',
   'Handbuch gedruckt', 'DIN A5, 48 Seiten, Klebebindung', 'piece', 12.50, 7.00);


-- ===========================================================================
-- 4. Kontakte
-- ===========================================================================
--
-- Drei Stueck, und die Unterschiede sind der Punkt:
--
--  * `business` mit USt-IdNr. — gegenueber einem Unternehmen gelten 9
--    Prozentpunkte ueber dem Basiszinssatz (§ 288 Abs. 2 BGB) und die
--    40-Euro-Pauschale (§ 288 Abs. 5 BGB).
--  * `consumer` — 5 Prozentpunkte (§ 288 Abs. 1 BGB), keine Pauschale.
--  * `NULL` — "unbekannt", nicht "Unternehmen". Erst dadurch zeigt der
--    Mahnen-Dialog seine Rueckfrage, und man sieht sie beim Durchklicken.
--    Genau dafuer ist die Spalte nullbar (siehe Migration 040).
--
-- Alle drei tragen eine E-Mail: ohne sie (BT-49) laesst sich keine Rechnung
-- fertigstellen.
INSERT INTO public.contacts (id, company_id, name, address, email, vat_id, customer_type, contact_name, contact_phone, contact_email, created_at) VALUES
  (
    '33333333-3333-3333-3333-333333333301',
    '22222222-2222-2222-2222-222222222222',
    'Nordlicht Medien GmbH',
    '{"street": "Königsallee", "streetnumber": "47", "addressline2": "3. OG, Abteilung Einkauf", "zip": "40212", "city": "Düsseldorf", "country": "DE"}'::jsonb,
    'buchhaltung@nordlicht-medien.example',
    'DE812345678',
    'business',
    'Jana Hoffmann',
    '+49 211 998877-0',
    'j.hoffmann@nordlicht-medien.example',
    now() - interval '28 days'
  ),
  (
    '33333333-3333-3333-3333-333333333302',
    '22222222-2222-2222-2222-222222222222',
    'Katharina Vogt',
    '{"street": "Lindenweg", "streetnumber": "3a", "zip": "24103", "city": "Kiel", "country": "DE"}'::jsonb,
    'katharina.vogt@example.org',
    NULL,
    'consumer',
    NULL,
    NULL,
    NULL,
    now() - interval '24 days'
  ),
  (
    '33333333-3333-3333-3333-333333333303',
    '22222222-2222-2222-2222-222222222222',
    'Hofladen Brinkmann e. K.',
    '{"street": "Dorfstraße", "streetnumber": "18", "zip": "26160", "city": "Bad Zwischenahn", "country": "DE"}'::jsonb,
    'info@hofladen-brinkmann.example',
    NULL,
    -- Bewusst NULL: Diese Rechnung soll beim Mahnen die Rueckfrage ausloesen.
    NULL,
    'Heiko Brinkmann',
    '+49 4403 55512',
    'h.brinkmann@hofladen-brinkmann.example',
    now() - interval '20 days'
  );


-- ===========================================================================
-- 5. Rechnungen
-- ===========================================================================
--
-- Sechs Belege, die zusammen jeden Zustand abdecken, an dem in der
-- Oberflaeche etwas haengt. Zu den Betraegen: Sie folgen demselben Modell wie
-- lib/invoice-totals.ts — je Position runden, dann die gerundeten Werte
-- summieren, und die Umsatzsteuer je Steuersatz aus der gerundeten
-- Bemessungsgrundlage. Alle Zahlen hier gehen glatt auf; es gibt also keinen
-- Rundungsfall, ueber den PDF und XRechnung streiten koennten.
--
-- `seller_snapshot` und `buyer_snapshot` werden weiter unten in einem
-- Rutsch gesetzt (Abschnitt 6), damit sie garantiert zu den Firmen- und
-- Kontaktzeilen passen und nicht sechsmal abgeschrieben werden muessen.
--
-- `pdf_url` und `xml_url` bleiben leer: Die Dateien liegen in S3, und das
-- gibt es lokal nicht. Ein erfundener Link saehe aus wie ein Dokument und
-- waere beim Klick ein Fehler — die Luecke ist ehrlicher.

-- 5.1 Entwurf mit Positionen -------------------------------------------------
--
-- Noch keine Rechnungsnummer, kein finalized_at. Der Entwurf traegt schon
-- einen Empfaenger und zwei Positionen, laesst sich also direkt oeffnen und
-- fertigstellen.
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444401',
  '22222222-2222-2222-2222-222222222222',
  'draft', 'invoice', NULL,
  current_date, current_date + 30, current_date,
  true, false, '33333333-3333-3333-3333-333333333302',
  -- Mehrzeilige Beschreibung: Der Zeilenumbruch im Text ist der Fall, an dem
  -- der Positionsblock im PDF umbrechen statt abschneiden muss.
  '[
    {"id": "pos-1", "description": "Aufnahme des Ist-Zustands\nGespräche mit vier Fachbereichen, Protokoll und Auswertung", "quantity": 8, "unit": "hour", "unit_price": 110.00, "vat_rate": 19, "total": 880.00},
    {"id": "pos-2", "description": "Reisekosten nach Kilometerpauschale", "quantity": 240, "unit": "km", "unit_price": 0.30, "vat_rate": 19, "total": 72.00}
  ]'::jsonb,
  952.00, 180.88, 1132.88,
  'de', 'katharina.vogt@example.org',
  now() - interval '2 days'
);

-- 5.2 Fertiggestellt, noch nicht faellig -------------------------------------
--
-- Die Rechnung mit mehreren Positionen, zwei Steuersaetzen und mehrzeiligen
-- Beschreibungen — der Beleg, an dem sich die Darstellung pruefen laesst.
--
-- Rechnen: 2.280,00 + 510,00 + 149,00 = 2.939,00 zu 19 % -> 558,41 USt.
--          125,00 zu 7 % -> 8,75 USt.
--          Netto 3.064,00 + USt 567,16 = 3.631,16 brutto.
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id, contact_person_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, buyer_reference,
  intro_text, outro_text, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444402',
  '22222222-2222-2222-2222-222222222222',
  'sent', 'invoice', 'RE-0001',
  current_date - 5, current_date + 25, current_date - 12,
  true, false, '33333333-3333-3333-3333-333333333301', 'ap-projekte',
  '[
    {"id": "pos-1", "description": "Konzeption und Umsetzung des Relaunch\nInklusive Informationsarchitektur, Wireframes und zwei Abnahmerunden", "quantity": 24, "unit": "hour", "unit_price": 95.00, "vat_rate": 19, "total": 2280.00},
    {"id": "pos-2", "description": "Redaktionelle Pflege der Inhalte\nZwei Termine je Woche, Abrechnung nach Aufwand", "quantity": 6, "unit": "hour", "unit_price": 85.00, "vat_rate": 19, "total": 510.00},
    {"id": "pos-3", "description": "Lizenz Bildmaterial", "quantity": 1, "unit": "piece", "unit_price": 149.00, "vat_rate": 19, "total": 149.00},
    {"id": "pos-4", "description": "Gedrucktes Handbuch zur Übergabe\nDIN A5, 48 Seiten, Klebebindung", "quantity": 10, "unit": "piece", "unit_price": 12.50, "vat_rate": 7, "total": 125.00}
  ]'::jsonb,
  3064.00, 567.16, 3631.16,
  'de', 'buchhaltung@nordlicht-medien.example', 'BST-2026-0417',
  'vielen Dank für die gute Zusammenarbeit. Nachstehend stellen wir Ihnen die vereinbarten Leistungen in Rechnung.',
  'Bitte überweisen Sie den Betrag ohne Abzug auf das unten genannte Konto.',
  now() - interval '5 days', now() - interval '6 days'
);

-- 5.3 Ueberfaellig, Regelfall ------------------------------------------------
--
-- Rechnungsdatum vor 60 Tagen, faellig vor 30 Tagen. Zahlungsziel 30 Tage,
-- also faellt der Verzugsbeginn nach § 286 Abs. 3 BGB mit der Faelligkeit
-- zusammen (Rechnungsdatum + 30 ergibt denselben Tag). Der Normalfall.
--
-- Status `reminded`, weil weiter unten eine Mahnung dazu versendet wurde:
-- `reminded` sagt aus, dass gemahnt *wurde*, und das stimmt erst, wenn das
-- Schreiben draussen ist.
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444403',
  '22222222-2222-2222-2222-222222222222',
  'reminded', 'invoice', 'RE-0002',
  current_date - 60, current_date - 30, current_date - 60,
  true, false, '33333333-3333-3333-3333-333333333301',
  '[
    {"id": "pos-1", "description": "Monatliche Betreuung der Serverumgebung\nBetrieb, Sicherheitsupdates und Monitoring", "quantity": 1, "unit": "month", "unit_price": 1200.00, "vat_rate": 19, "total": 1200.00}
  ]'::jsonb,
  1200.00, 228.00, 1428.00,
  'de', 'buchhaltung@nordlicht-medien.example',
  now() - interval '60 days', now() - interval '61 days'
);

-- 5.4 Ueberfaellig mit verkuerztem Zahlungsziel ------------------------------
--
-- Der Fall, fuer den der 30-Tage-Boden aus § 286 Abs. 3 BGB ueberhaupt da
-- ist: Rechnungsdatum vor 45 Tagen, aufgedrucktes Zahlungsziel 14 Tage, also
-- Faelligkeit vor 31 Tagen. Ein einseitig aufgedrucktes Ziel ist aber keine
-- kalendermaessige Bestimmung nach § 286 Abs. 2 Nr. 1 und verkuerzt den
-- gesetzlichen Verzugseintritt nicht — der Verzugsbeginn ist deshalb
-- Rechnungsdatum + 30 Tage, also erst vor 15 Tagen.
--
-- Faelligkeit (vor 31 Tagen) und Verzugsbeginn (vor 15 Tagen) fallen hier
-- also auseinander, und genau das muss der Mahnen-Dialog getrennt anzeigen.
--
-- Der Empfaenger hat bewusst kein `customer_type`: Zusammen ergibt das den
-- interessantesten Dialog, den die Anwendung zu bieten hat.
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444404',
  '22222222-2222-2222-2222-222222222222',
  'sent', 'invoice', 'RE-0003',
  current_date - 45, current_date - 31, current_date - 47,
  true, false, '33333333-3333-3333-3333-333333333303',
  '[
    {"id": "pos-1", "description": "Workshop Datenschutz für das Vertriebsteam\nTagessatz inklusive Vor- und Nachbereitung", "quantity": 2, "unit": "day", "unit_price": 980.00, "vat_rate": 19, "total": 1960.00}
  ]'::jsonb,
  1960.00, 372.40, 2332.40,
  'de', 'info@hofladen-brinkmann.example',
  now() - interval '45 days', now() - interval '46 days'
);

-- 5.5 Bezahlt ----------------------------------------------------------------
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444405',
  '22222222-2222-2222-2222-222222222222',
  'paid', 'invoice', 'RE-0004',
  current_date - 40, current_date - 10, current_date - 42,
  true, false, '33333333-3333-3333-3333-333333333302',
  '[
    {"id": "pos-1", "description": "Erstellung des Jahresberichts", "quantity": 1, "unit": "piece", "unit_price": 450.00, "vat_rate": 19, "total": 450.00}
  ]'::jsonb,
  450.00, 85.50, 535.50,
  'de', 'katharina.vogt@example.org',
  now() - interval '40 days', now() - interval '41 days'
);

-- 5.6 Storniert, samt Stornorechnung -----------------------------------------
--
-- Zwei Zeilen, die zusammengehoeren: Das Original steht auf `cancelled`, die
-- Stornorechnung traegt `invoice_type = 'cancellation'`, zeigt ueber
-- `cancelled_invoice_id` auf das Original und hat durchgaengig negierte
-- Betraege — Positionen, Netto, Umsatzsteuer und Brutto. So legt es
-- `cancelInvoice` in lib/invoice-service.ts an.
--
-- Die Stornorechnung zieht ihre Nummer aus dem eigenen Nummernkreis (ST-),
-- nicht aus dem Rechnungskreis.
INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  language, recipient_email, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444406',
  '22222222-2222-2222-2222-222222222222',
  'cancelled', 'invoice', 'RE-0005',
  current_date - 20, current_date + 10, current_date - 22,
  true, false, '33333333-3333-3333-3333-333333333301',
  '[
    {"id": "pos-1", "description": "Beratung zur Einführung der E-Rechnung", "quantity": 3, "unit": "hour", "unit_price": 140.00, "vat_rate": 19, "total": 420.00}
  ]'::jsonb,
  420.00, 79.80, 499.80,
  'de', 'buchhaltung@nordlicht-medien.example',
  now() - interval '20 days', now() - interval '21 days'
);

INSERT INTO public.invoices (
  id, company_id, status, invoice_type, invoice_number,
  invoice_date, due_date, service_date,
  seller_is_self, buyer_is_self, buyer_contact_id,
  line_items, subtotal, vat_amount, total_amount,
  cancelled_invoice_id,
  language, recipient_email, finalized_at, created_at
) VALUES (
  '44444444-4444-4444-4444-444444444407',
  '22222222-2222-2222-2222-222222222222',
  'created', 'cancellation', 'ST-0001',
  current_date - 18, current_date + 10, current_date - 22,
  true, false, '33333333-3333-3333-3333-333333333301',
  '[
    {"id": "pos-1", "description": "Beratung zur Einführung der E-Rechnung", "quantity": -3, "unit": "hour", "unit_price": 140.00, "vat_rate": 19, "total": -420.00}
  ]'::jsonb,
  -420.00, -79.80, -499.80,
  '44444444-4444-4444-4444-444444444406',
  'de', 'buchhaltung@nordlicht-medien.example',
  now() - interval '18 days', now() - interval '18 days'
);


-- ===========================================================================
-- 6. Die eingefrorenen Parteien
-- ===========================================================================
--
-- Einmal abgeleitet statt siebenmal abgeschrieben. Das ist nicht nur kuerzer,
-- sondern auch richtiger: Die Snapshots entsprechen damit zwangslaeufig den
-- Firmen- und Kontaktzeilen oben, so wie sie `finalizeInvoice` beim
-- Fertigstellen erzeugt haette. Wer eine Adresse im Seed aendert, aendert sie
-- an genau einer Stelle.
--
-- Der Entwurf bekommt bewusst KEINEN Absender-Snapshot: Den schreibt erst das
-- Fertigstellen. Einen Empfaenger-Snapshot traegt er dagegen schon, weil der
-- Editor ihn beim Speichern mitschreibt.

UPDATE public.invoices i
SET seller_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'name',              c.name,
      'address',           c.address,
      'vat_id',            c.vat_id,
      'tax_id',            c.tax_id,
      'bank_details',      c.bank_details,
      -- Der gewaehlte weitere Ansprechpartner, sonst der Standard aus den
      -- Firmendaten — dieselbe Regel wie resolveSellerContact().
      'contact',           COALESCE(
                             (SELECT jsonb_build_object('name', a->>'name', 'phone', a->>'phone', 'email', a->>'email')
                              FROM jsonb_array_elements(c.additional_contacts) a
                              WHERE a->>'id' = i.contact_person_id),
                             jsonb_build_object('name', c.contact_name, 'phone', c.contact_phone, 'email', c.contact_email)
                           ),
      'court',             c.court,
      'register_number',   c.register_number,
      'managing_director', c.managing_director
    ))
FROM public.companies c
WHERE c.id = i.company_id
  AND i.company_id = '22222222-2222-2222-2222-222222222222'
  AND i.seller_is_self
  AND i.status <> 'draft';

UPDATE public.invoices i
SET buyer_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'id',      k.id,
      'name',    k.name,
      'address', k.address,
      'email',   k.email,
      'vat_id',  k.vat_id
    ))
FROM public.contacts k
WHERE k.id = i.buyer_contact_id
  AND i.company_id = '22222222-2222-2222-2222-222222222222';


-- ===========================================================================
-- 7. Mahnungen
-- ===========================================================================
--
-- Zwei Stueck zur ueberfaelligen Rechnung RE-0002 (Abschnitt 5.3): eine
-- versendete Zahlungserinnerung und ein Entwurf der 1. Mahnung. Damit zeigt
-- die Beleguebersicht endlich Zeilen, und beide abgeleiteten Zustaende
-- (Entwurf, Versendet) werden sichtbar.
--
-- Stufenwerte sind Kopien, keine Verweise: `stage_position` und `stage_name`
-- stammen aus dem Standardsatz in lib/dunning-stages.ts, es gibt aber
-- bewusst keinen Fremdschluessel dorthin (siehe Migration 040).
--
-- Der Zeitplan folgt dem Standardsatz: Stufe 1 sieben Tage nach Verzugsbeginn
-- mit sieben Tagen Nachfrist, Stufe 2 sieben Tage nach deren Ablauf.
--   Verzugsbeginn = Faelligkeit = heute - 30
--   Stufe 1: geschrieben heute - 23, neue Frist heute - 16
--   Stufe 2: geschrieben heute -  9, neue Frist heute -  2

-- 7.1 Zahlungserinnerung, versendet ------------------------------------------
--
-- Stufe 1 fordert nach dem Standardsatz weder Gebuehr noch Zinsen noch
-- Pauschale: Vor Verzug ist nichts ersatzfaehig, und Verzug begruendet
-- ueberhaupt erst dieses Schreiben. Also nur die Hauptforderung, und
-- `total_amount` ist gleich `claimed_amount` — so, wie es der CHECK
-- payment_reminders_total_is_sum nachrechnet.
--
-- `interest_segments` bleibt NULL, was der CHECK
-- payment_reminders_interest_has_segments ausdruecklich erlaubt, solange
-- `interest_amount` null ist.
INSERT INTO public.payment_reminders (
  id, company_id, invoice_id,
  stage_position, stage_name, status,
  reminder_date, due_date, default_since, invoice_due_date,
  claimed_amount, fee_amount, late_fee_flat, interest_amount,
  total_amount,
  language, recipient_email, sent_at, created_at
) VALUES (
  '55555555-5555-5555-5555-555555555501',
  '22222222-2222-2222-2222-222222222222',
  '44444444-4444-4444-4444-444444444403',
  1, 'Zahlungserinnerung', 'sent',
  current_date - 23, current_date - 16, current_date - 30, current_date - 30,
  1428.00, 0, 0, 0,
  1428.00,
  'de', 'buchhaltung@nordlicht-medien.example',
  now() - interval '23 days', now() - interval '23 days'
);

-- 7.2 1. Mahnung, Entwurf ----------------------------------------------------
--
-- Hier haengen die Zinsen dran, und die lassen sich nicht einfach hinschreiben:
-- Der Zinszeitraum wandert mit current_date mit und kann ueber einen
-- Jahreswechsel oder eine Satzaenderung laufen. Dann traegt er nicht *einen*
-- Satz, sondern mehrere, und `interest_segments` muss jedes Teilstueck einzeln
-- ausweisen — sonst waere der Betrag eine Behauptung ohne Beleg.
--
-- Dieser Block bildet deshalb computeDefaultInterest() aus
-- lib/dunning-interest.ts nach: taggenau (act/act), geteilt an jeder
-- Satzaenderung und an jedem Jahreswechsel, je Abschnitt gerundet und dann
-- summiert, nie Zinseszins (§ 289 Satz 1 BGB).
--
-- Der Schuldner ist ein Unternehmen, also 9 Prozentpunkte ueber dem
-- Basiszinssatz (§ 288 Abs. 2 BGB) und einmalig die 40-Euro-Pauschale
-- (§ 288 Abs. 5 BGB).
DO $seed$
DECLARE
  -- Der offene Bruttobetrag: § 288 verzinst die Bruttoforderung, die
  -- Umsatzsteuer schuldet der Kunde ebenso.
  v_betrag        CONSTANT numeric(10,2) := 1428.00;
  -- Neun Prozentpunkte, weil der Empfaenger `customer_type = 'business'` ist.
  v_aufschlag     CONSTANT numeric(5,2)  := 9;
  -- Erster Zinstag: der Tag NACH dem Verzugsbeginn (§ 187 Abs. 1 BGB).
  v_von           CONSTANT date := current_date - 29;
  -- Letzter berechneter Tag: das Mahndatum.
  v_bis           CONSTANT date := current_date - 9;

  v_segmente      jsonb := '[]'::jsonb;
  v_cursor        date;
  v_grenze        date;
  v_ende          date;
  v_tage          integer;
  v_basiszins     numeric(5,2);
  v_satz          numeric(5,2);
  v_jahrestage    integer;
  v_teilbetrag    numeric(10,2);
  v_ungeprueft    boolean;

  v_zinsen        numeric(10,2);
  v_zinstage      integer;
  v_saetze        integer;
  v_basen         integer;
BEGIN
  v_cursor := v_von;

  WHILE v_cursor <= v_bis LOOP
    -- Die naechste Grenze: entweder eine Aenderung des Basiszinssatzes oder
    -- der naechste 1. Januar. Der Jahreswechsel hat nichts mit dem Satz zu
    -- tun — er haelt jeden Abschnitt in genau einem Kalenderjahr, damit der
    -- Teiler (365 oder 366) eindeutig ist.
    SELECT min(g) INTO v_grenze
    FROM (VALUES
      -- Spiegelt BASE_RATES aus lib/dunning-interest.ts. Nur die Termine, an
      -- denen sich der Satz tatsaechlich geaendert hat.
      (DATE '2026-07-01'), (DATE '2025-07-01'), (DATE '2025-01-01'),
      (DATE '2024-07-01'), (DATE '2024-01-01'), (DATE '2023-07-01'),
      (DATE '2023-01-01'),
      ((date_trunc('year', v_cursor) + interval '1 year')::date)
    ) AS grenzen(g)
    WHERE g > v_cursor;

    v_ende := LEAST(v_bis, v_grenze - 1);
    v_tage := (v_ende - v_cursor) + 1;

    v_basiszins := CASE
      WHEN v_cursor >= DATE '2026-07-01' THEN  1.52
      WHEN v_cursor >= DATE '2025-07-01' THEN  1.27
      WHEN v_cursor >= DATE '2025-01-01' THEN  2.27
      WHEN v_cursor >= DATE '2024-07-01' THEN  3.37
      WHEN v_cursor >= DATE '2024-01-01' THEN  3.62
      WHEN v_cursor >= DATE '2023-07-01' THEN  3.12
      WHEN v_cursor >= DATE '2023-01-01' THEN  1.62
      ELSE                                    -0.88
    END;
    v_satz := v_basiszins + v_aufschlag;

    -- Die echte Laenge des Kalenderjahres, in dem der Abschnitt liegt.
    v_jahrestage := ((date_trunc('year', v_cursor) + interval '1 year')::date
                     - date_trunc('year', v_cursor)::date);

    -- `stale` wie in baseRateFor(): Liegt der Abschnitt in einem Halbjahr,
    -- das BASE_RATES_PUBLISHED_THROUGH nicht mehr abdeckt, ist der Satz
    -- fortgeschrieben und kein veroeffentlichter Wert. Weil der Seed mit dem
    -- Kalender mitwandert, wird das hier eines Tages von selbst wahr — und
    -- dann soll die Oberflaeche ihren Bestaetigungshinweis auch zeigen.
    v_ungeprueft := make_date(
                      EXTRACT(year FROM v_cursor)::int,
                      CASE WHEN EXTRACT(month FROM v_cursor)::int <= 6 THEN 1 ELSE 7 END,
                      1
                    ) > DATE '2026-07-01';

    -- Immer auf den Ausgangsbetrag, nie auf Betrag plus aufgelaufene Zinsen.
    v_teilbetrag := round(v_betrag * (v_satz / 100) * v_tage / v_jahrestage, 2);

    -- Form eins zu eins wie InterestSegment in lib/dunning-interest.ts.
    v_segmente := v_segmente || jsonb_build_object(
      'from',       to_char(v_cursor, 'YYYY-MM-DD'),
      'to',         to_char(v_ende,   'YYYY-MM-DD'),
      'days',       v_tage,
      'baseRate',   v_basiszins,
      'ratePercent', v_satz,
      'daysInYear', v_jahrestage,
      'amount',     v_teilbetrag,
      'stale',      v_ungeprueft
    );

    v_cursor := v_ende + 1;
  END LOOP;

  SELECT round(sum((s->>'amount')::numeric), 2),
         sum((s->>'days')::int),
         count(DISTINCT s->>'ratePercent'),
         count(DISTINCT s->>'baseRate')
  INTO v_zinsen, v_zinstage, v_saetze, v_basen
  FROM jsonb_array_elements(v_segmente) s;

  INSERT INTO public.payment_reminders (
    id, company_id, invoice_id,
    stage_position, stage_name, status,
    reminder_date, due_date, default_since, invoice_due_date,
    claimed_amount, fee_amount, late_fee_flat, interest_amount,
    interest_segments, interest_rate, base_rate, interest_from, interest_days,
    total_amount,
    language, recipient_email, created_at
  ) VALUES (
    '55555555-5555-5555-5555-555555555502',
    '22222222-2222-2222-2222-222222222222',
    '44444444-4444-4444-4444-444444444403',
    2, '1. Mahnung', 'created',
    v_bis, current_date - 2, current_date - 30, current_date - 30,
    v_betrag,
    -- Keine Mahngebuehr: Ersatzfaehig sind nur tatsaechliche Kosten
    -- (§ 286 Abs. 4 BGB), und bei einer E-Mail entstehen praktisch keine.
    0,
    -- Die Pauschale nach § 288 Abs. 5 BGB — einmal je Forderung, deshalb nur
    -- auf dieser Stufe und nicht noch einmal auf der letzten.
    40.00,
    v_zinsen,
    v_segmente,
    -- Nur Anzeigewerte, und nur wenn der ganze Zeitraum EINEN Satz traegt.
    -- Sonst NULL: Ein tagesgewichteter Durchschnitt saehe aus wie der
    -- geltende Satz, liesse sich aber nicht nachrechnen.
    CASE WHEN v_saetze = 1 THEN (v_segmente->0->>'ratePercent')::numeric END,
    CASE WHEN v_basen  = 1 THEN (v_segmente->0->>'baseRate')::numeric    END,
    -- Diese beiden bleiben auch ueber mehrere Abschnitte eindeutig.
    v_von,
    v_zinstage,
    -- Summe der Teile; der CHECK payment_reminders_total_is_sum rechnet in
    -- NUMERIC exakt nach und duldet keinen Rundungsrest.
    v_betrag + 0 + 40.00 + v_zinsen,
    'de', 'buchhaltung@nordlicht-medien.example',
    now() - interval '9 days'
  );
END
$seed$;

-- Die Parteien der Mahnungen: der Absender so, wie die Firma heute aussieht
-- (die Mahnung ist ein neues Schreiben und soll das heutige Konto nennen),
-- der Empfaenger dagegen unveraendert aus der Rechnung — Schuldner ist, wer
-- auf der Rechnung stand. Genau diese Aufteilung macht lib/dunning-service.ts.
UPDATE public.payment_reminders m
SET seller_snapshot = i.seller_snapshot,
    buyer_snapshot  = i.buyer_snapshot
FROM public.invoices i
WHERE i.id = m.invoice_id
  AND m.company_id = '22222222-2222-2222-2222-222222222222';
