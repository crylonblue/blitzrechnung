# blitzrechnung

Einfache, sichere und ruhige Rechnungserstellung für kleine bis mittelgroße Unternehmen.

> **Note:** Der Brandname ist über die Umgebungsvariable `NEXT_PUBLIC_APP_NAME` konfigurierbar.

## Features (MVP)

- ✅ **Draft-first Workflow**: Rechnungen stressfrei vorbereiten und bewusst finalisieren
- ✅ **Entwürfe verwalten**: Liste aller offenen Entwürfe mit Bearbeitungsfunktion
- ✅ **Rechnung finalisieren**: Validierung, Rechnungsnummern-Vergabe, Status-Management
- ✅ **Rechnungs-Historie**: Übersicht aller finalisierten Rechnungen mit Status-Tracking
- ✅ **Kundenverwaltung**: CRUD-Operationen für Kunden
- ✅ **Firmeneinstellungen**: Verwaltung von Firmendaten und Standardwerten
- ✅ **Authentifizierung**: Email/Passwort und Google Login

## Tech Stack

- **Frontend**: Next.js 16 (App Router)
- **Backend/Datenbank/Auth**: Supabase
- **Styling**: Tailwind CSS
- **TypeScript**: Vollständig typisiert

## Setup

### 1. Supabase Projekt erstellen

1. Erstelle ein neues Projekt auf [supabase.com](https://supabase.com)
2. Gehe zu SQL Editor und führe die Migration aus: `supabase/migrations/001_initial_schema.sql`
3. Aktiviere Google OAuth in den Authentication Settings (optional)

### 2. Umgebungsvariablen

Erstelle eine `.env.local` Datei im Root-Verzeichnis:

```env
NEXT_PUBLIC_SUPABASE_URL=deine_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=dein_supabase_anon_key
```

### 3. Dependencies installieren

```bash
pnpm install
```

### 4. Development Server starten

```bash
pnpm dev
```

Die App läuft dann auf [http://localhost:3000](http://localhost:3000)

## Architektur

### Datenmodell

- **Company**: Oberste Entität, repräsentiert ein Unternehmen
- **User**: Benutzer mit Profil
- **CompanyUser**: Join-Tabelle für User-Company-Beziehungen
- **Customer**: Kunden (sekundäre Entität, primär als Komfortfunktion)
- **Invoice**: Rechnungen mit Statusmodell (Draft → Created → Sent → Paid)

### Invoice-Generation-Service

Die eigentliche PDF/ZUGFeRD-Generierung wird von einem separaten Service übernommen. Im MVP ist dies als TODO markiert in `components/drafts/draft-editor.tsx`.

Beim Finalisieren einer Rechnung:
1. App validiert die Daten
2. App vergibt die Rechnungsnummer
3. App friert die Daten ein (Snapshot)
4. App sendet die Rechnungsdaten an den Invoice-Service (TODO)
5. Invoice-Service erzeugt PDF + ZUGFeRD
6. App speichert die Referenz und setzt Status auf 'created'

## UX-Prinzipien

- **Draft-first**: Nichts passiert automatisch
- **Inline Editing**: Direkte Bearbeitung ohne Modals
- **Ruhige UI**: Minimalistisches Design
- **Explizite Statuswechsel**: Klare Aktionen für jeden Statuswechsel
- **Fehler vermeiden statt erklären**: Validierung vor dem Finalisieren

## Projektstruktur

```
blitzrechnung/
├── app/
│   ├── (app)/          # Geschützte Routen (erfordern Auth)
│   │   ├── drafts/     # Entwürfe
│   │   ├── invoices/   # Finalisierte Rechnungen
│   │   ├── customers/  # Kundenverwaltung
│   │   └── settings/   # Firmeneinstellungen
│   ├── login/          # Login-Seite
│   ├── signup/         # Registrierung
│   └── auth/           # Auth-Callbacks
├── components/
│   ├── drafts/         # Draft-Komponenten
│   ├── invoices/       # Invoice-Komponenten
│   ├── customers/      # Customer-Komponenten
│   └── settings/       # Settings-Komponenten
├── lib/
│   └── supabase/       # Supabase Client Utilities
├── types/              # TypeScript Types
└── supabase/
    └── migrations/     # Datenbank-Migrationen
```

## Nächste Schritte

- [ ] Invoice-Generation-Service Integration
- [ ] PDF-Download-Funktionalität
- [ ] Erweiterte Filter und Suche
- [ ] Wiederkehrende Rechnungen (nicht MVP)
- [ ] Mahnungen (nicht MVP)
- [ ] Payment-Integrationen (nicht MVP)

## Lizenz

Private Projekt
