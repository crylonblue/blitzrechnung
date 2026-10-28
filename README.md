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
- ✅ **Girocode**: EPC-QR-Code auf der Rechnung — Kunden scannen ihn mit der Banking-App und die Überweisung ist vorausgefüllt
- ✅ **Authentifizierung**: Email/Passwort und Google Login

## Tech Stack

- **Frontend**: Next.js 16 (App Router)
- **Backend/Datenbank/Auth**: Supabase
- **Styling**: Tailwind CSS
- **TypeScript**: Vollständig typisiert

## Setup

### Lokal entwickeln (empfohlen)

Voraussetzungen: Docker, [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), pnpm.

```bash
pnpm install
pnpm db:start                         # Postgres, Auth, REST, Storage, Studio, Mailpit in Docker
pnpm db:env                           # schreibt .env.local mit den Schlüsseln der lokalen Instanz
pnpm dev
```

Die App läuft auf [http://localhost:3000](http://localhost:3000). Anmelden mit dem Seed-Konto
`hello@till.email` / `Email123!` — es hat Firma, Kontakte und Beispielrechnungen
(`supabase/seed.sql`).

**Ports.** Die lokale Instanz belegt bewusst **55320–55329** statt der Supabase-Standardreihe
54321–54329, damit sie neben anderen Supabase-Projekten laufen kann (siehe `supabase/config.toml`):

| Dienst        | Port  |
| ------------- | ----- |
| API           | 55321 |
| Postgres      | 55322 |
| Studio        | 55323 |
| Mailpit (Web) | 55324 |

Direktzugriff auf die Datenbank: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.
Ist einer der Ports bei dir belegt, ändere ihn in `supabase/config.toml` und passe
`NEXT_PUBLIC_SUPABASE_URL` in `.env.local` an.

Nützlich:

```bash
pnpm db:reset   # Datenbank neu aufbauen: alle Migrationen, dann der Seed
pnpm db:stop    # Container anhalten (Daten bleiben erhalten)
```

Mehrere Worktrees desselben Repos teilen sich diese eine Instanz — `pnpm db:start` meldet in
einem zweiten Worktree, dass sie schon läuft. Das ist gewollt, heißt aber: Ein `db:reset` wirkt
auf alle.

Dateien (PDF, XML, Logo) landen lokal im Bucket `blitzrechnung` von Supabase Storage, den die App
über dieselbe S3-Schnittstelle anspricht wie in Produktion Cloudflare R2. Die Werte stehen schon in
`.env.local.example`; die Schlüssel setzt `pnpm db:env` aus der laufenden Instanz ein — sie stehen
bewusst nicht im Repo. Nur der E-Mail-Versand braucht echte Zugangsdaten (`AHASEND_*`).

**Orca.** `orca.yaml` lässt jeden neuen Workspace `scripts/orca-setup.sh` ausführen: Es übernimmt
die `.env.local` aus dem Primary-Checkout (sonst die Vorlage) und installiert die Abhängigkeiten
mit der pnpm-Version aus `packageManager` in der package.json — dieselbe wie in CI und auf Vercel. Einmalig im
Primary-Checkout: `pnpm db:env` (und dort ergänzen, was nur dir gehört, etwa `AHASEND_*`). Die Datenbank startet das Skript nicht; es weist nur darauf hin, wenn sie nicht läuft.

### Mit einem Supabase-Projekt in der Cloud

1. Erstelle ein neues Projekt auf [supabase.com](https://supabase.com)
2. Wende die Migrationen aus `supabase/migrations/` an (`supabase link` und `supabase db push`)
3. Aktiviere Google OAuth in den Authentication Settings (optional)
4. Lege `.env.local` mit `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` des Projekts an

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
