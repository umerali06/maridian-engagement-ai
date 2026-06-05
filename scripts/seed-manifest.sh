#!/bin/bash
# =============================================================================
# Seed manifest: lista todos los docs que vamos a meter al KB inicial.
# Corre esto DESPUÉS de tener Supabase configurado y el brand 'meridian' creado.
#
# Usage:
#   bash scripts/seed-manifest.sh
# =============================================================================

set -e

cd "$(dirname "$0")/.."

# Verifica que tenemos lo que necesitamos
if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" || -z "$NEXT_PUBLIC_SUPABASE_URL" ]]; then
  if [[ -f .env.local ]]; then
    set -a
    source .env.local
    set +a
  fi
fi

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" || -z "$NEXT_PUBLIC_SUPABASE_URL" ]]; then
  echo "ERROR: missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL"
  exit 1
fi

# ---- Lista de docs en orden de prioridad ----
DOCS=(
  # Estrategia Meridian (alta prioridad — define la marca)
  "/Users/MacBookair/Desktop/MERIDIAN DOCS/Marketing DATA/blueprint_meridian_ES_v10.docx.pdf"
  "/Users/MacBookair/Desktop/MERIDIAN DOCS/Marketing DATA/kpis_operativos_anexo (1).docx"
  "/Users/MacBookair/Desktop/MERIDIAN DOCS/Marketing DATA/presentacion_meridian.pdf"
  "/Users/MacBookair/Downloads/Meridian.pdf"

  # Voz de Josué + positioning
  "/Users/MacBookair/meridian-agents/FACU_COPY_PROJECT/meridian-copyboard/MERIDIAN-FOUNDERS-MASTER-v1.md"
  "/Users/MacBookair/meridian-agents/FACU_COPY_PROJECT/meridian-copyboard/ADS-CDMX-JOSUE-6ESCENAS.md"
  "/Users/MacBookair/meridian-agents/FACU_COPY_PROJECT/meridian-copyboard/IG-AGENT-SKILLS-MASTER.md"
  "/Users/MacBookair/Downloads/copy-broker-founders.md"

  # Trading técnico — para responder dudas reales
  "/Users/MacBookair/Downloads/Ebook_Checklis_CodigoSuizo.pdf"
  "/Users/MacBookair/Downloads/ebook_checklist_trader.pdf"
  "/Users/MacBookair/Downloads/copyboarding_codigo_suizo_v2.pdf"
  "/Users/MacBookair/Downloads/Albercas de liquidez ESCANEADO.pdf"
  "/Users/MacBookair/Downloads/🔍 ¿Cómo se forma un FVG.pdf"
  "/Users/MacBookair/Downloads/copyboarding.pdf"

  # FAQ trader / preguntas frecuentes
  "/Users/MacBookair/Downloads/preguntas para los ct.pdf"
  "/Users/MacBookair/Downloads/preguntas para los ct-2.pdf"

  # Compliance
  "/Users/MacBookair/Downloads/Meta_Ads_Compliance_Trading.docx"
)

echo "📚 Seeding ${#DOCS[@]} documents into Meridian KB..."
echo ""

# Filtra los que existen
EXISTING=()
for doc in "${DOCS[@]}"; do
  if [[ -f "$doc" ]]; then
    EXISTING+=("$doc")
    echo "  ✓ $(basename "$doc")"
  else
    echo "  ✗ NOT FOUND: $doc"
  fi
done

echo ""
echo "Procesando ${#EXISTING[@]} archivos válidos..."
echo ""

npx tsx scripts/seed-meridian-knowledge.ts "${EXISTING[@]}"
