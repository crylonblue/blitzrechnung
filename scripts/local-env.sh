#!/usr/bin/env bash
#
# Schreibt .env.local für die lokale Supabase-Instanz (pnpm db:start).
#
#   pnpm db:env             legt .env.local an, falls es sie noch nicht gibt
#   pnpm db:env --force     überschreibt eine vorhandene
#
# Die Schlüssel stehen bewusst nicht im Repo, auch nicht als Vorlage: Es sind die öffentlichen
# Standardwerte der Supabase-CLI, aber sie sehen für jeden Secret-Scanner (GitGuardian)
# genauso aus wie echte. Statt sie zu committen, liest dieses Skript sie aus der laufenden
# Instanz (`supabase status`) und setzt sie in .env.local.example ein.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ] && [ "${1:-}" != "--force" ]; then
  echo ".env.local gibt es schon — mit 'pnpm db:env --force' überschreiben."
  exit 0
fi

if ! status="$(supabase status -o env 2>/dev/null)" || [ -z "$status" ]; then
  echo "Die lokale Datenbank läuft nicht. Erst starten: pnpm db:start" >&2
  exit 1
fi

wert() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }

api_url="$(wert API_URL)"
for name in API_URL ANON_KEY SERVICE_ROLE_KEY S3_PROTOCOL_ACCESS_KEY_ID S3_PROTOCOL_ACCESS_KEY_SECRET S3_PROTOCOL_REGION STORAGE_S3_URL; do
  if [ -z "$(wert $name)" ]; then
    echo "supabase status liefert $name nicht — läuft Storage? (supabase/config.toml, [storage])" >&2
    exit 1
  fi
done

# Die Werte enthalten weder | noch & noch Zeilenumbrüche (JWT, Hex, URL).
sed \
  -e "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$api_url|" \
  -e "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$(wert ANON_KEY)|" \
  -e "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$(wert SERVICE_ROLE_KEY)|" \
  -e "s|^S3_ENDPOINT=.*|S3_ENDPOINT=$(wert STORAGE_S3_URL)|" \
  -e "s|^S3_REGION=.*|S3_REGION=$(wert S3_PROTOCOL_REGION)|" \
  -e "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(wert S3_PROTOCOL_ACCESS_KEY_ID)|" \
  -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(wert S3_PROTOCOL_ACCESS_KEY_SECRET)|" \
  -e "s|^S3_PUBLIC_URL=.*|S3_PUBLIC_URL=$api_url/storage/v1/object/public/blitzrechnung|" \
  .env.local.example > .env.local

echo ".env.local geschrieben (aus der laufenden Instanz: $api_url)."
