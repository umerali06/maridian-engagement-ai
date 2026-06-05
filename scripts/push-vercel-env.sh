#!/bin/bash
# Push every var from .env.local to Vercel (production env).
# Skips lines starting with #, blank lines, and TODO placeholders.

set -e
cd "$(dirname "$0")/.."

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # Skip empty values
  [[ -z "$value" ]] && continue

  echo "→ $key"
  # Pipe value as stdin so it handles special chars + idempotent: remove first if exists
  printf "y\n" | vercel env rm "$key" production 2>/dev/null || true
  printf "%s" "$value" | vercel env add "$key" production 2>&1 | tail -1
done < .env.local

echo ""
echo "✓ env vars synced to Vercel production"
