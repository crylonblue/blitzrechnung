#!/usr/bin/env bash
#
# Setup für einen neuen Orca-Workspace (siehe orca.yaml).
#
# Orca ruft das im neuen Worktree auf und setzt dabei
#   ORCA_ROOT_PATH      der Primary-Checkout dieses Repos
#   ORCA_WORKTREE_PATH  der neue Worktree (= aktuelles Verzeichnis)
#
# Was hier passiert:
#   1. `.env.local` aus dem Primary-Checkout übernehmen. Die Datei ist git-ignoriert und
#      fehlt deshalb in jedem frischen Worktree — ohne sie startet `pnpm dev` mit
#      "URL and Key are required". Gepflegt wird sie nur an einer Stelle: im Primary.
#      Fehlt sie dort, wird sie aus der laufenden Datenbank erzeugt (scripts/local-env.sh).
#   2. Abhängigkeiten installieren — mit der pnpm-Version aus package.json (packageManager).
#   3. Hinweis, falls die lokale Datenbank nicht läuft. Gestartet wird sie hier nicht:
#      Alle Worktrees teilen sich eine Instanz (supabase/config.toml, project_id), und ein
#      Start gehört nicht in den Hook jedes einzelnen.
#
# Läuft auch von Hand: ORCA_ROOT_PATH=/pfad/zum/primary bash scripts/orca-setup.sh

set -euo pipefail

cd "${ORCA_WORKTREE_PATH:-.}"

# --- 1. Umgebung -----------------------------------------------------------------------

# Ob die lokale Datenbank läuft, braucht Schritt 1 (Schlüssel auslesen) und Schritt 3 (Hinweis).
# Der Port steht in supabase/config.toml ([api] port); .env.local zeigt auf denselben.
api_port="$(awk '/^\[api\]/{f=1;next} /^\[/{f=0} f && /^port/{print $3; exit}' supabase/config.toml 2>/dev/null || true)"
db_laeuft() { [ -n "$api_port" ] && (exec 3<>"/dev/tcp/127.0.0.1/$api_port") 2>/dev/null; }

if [ -f .env.local ]; then
  echo "[setup] .env.local ist schon da — bleibt unverändert."
elif [ -n "${ORCA_ROOT_PATH:-}" ] && [ -f "$ORCA_ROOT_PATH/.env.local" ]; then
  cp "$ORCA_ROOT_PATH/.env.local" .env.local
  echo "[setup] .env.local aus dem Primary-Checkout übernommen."
elif db_laeuft && bash scripts/local-env.sh; then
  echo "[setup] Tipp: im Primary-Checkout einmal 'pnpm db:env' ausführen, dann erben alle neuen Workspaces die Datei."
else
  cp .env.local.example .env.local
  echo "[setup] WARNUNG: Keine Schlüssel verfügbar — .env.local aus der Vorlage hat leere Werte."
  echo "[setup] Datenbank starten und Schlüssel einsetzen: pnpm db:start && pnpm db:env --force"
fi

# --- 2. Abhängigkeiten ---------------------------------------------------------------------

# Welche pnpm-Version gilt, steht in package.json (`packageManager`); ein global installiertes
# pnpm wechselt von selbst dorthin. Ohne globales pnpm holt npx genau diese Version.
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
else
  pnpm_version="$(node -p 'require("./package.json").packageManager')"
  echo "[setup] pnpm fehlt — nutze npx $pnpm_version."
  npx --yes "$pnpm_version" install --frozen-lockfile
fi

# --- 3. Datenbank --------------------------------------------------------------------------

if ! db_laeuft; then
  echo "[setup] Die lokale Datenbank läuft nicht (Port ${api_port:-?}). Starten mit: pnpm db:start"
fi

echo "[setup] Fertig."
