# 👋 Buenos días Josue

Este es el orden literal para arrancar. Si haces todo seguido sin distracciones, en ~90 minutos tienes el sistema respondiendo DMs reales.

## Lo que dejé hecho mientras dormías

✅ Repo completo en `/Users/MacBookair/meridian-engagement-ai/`
✅ SPEC.md con la arquitectura completa adaptada a Meridian (es el Agent #4 de tu blueprint)
✅ Esquema Supabase con multi-tenancy, RLS, pgvector
✅ Webhook → AI brain → Claude + RAG + tools → reply a ManyChat
✅ Dashboard Next.js con: overview, conversaciones, knowledge base, learnings, brands, settings
✅ Learning loop nocturno (cron 3am) con review humano antes de aplicar
✅ Handoff a humano vía tag de ManyChat + alerta Telegram
✅ Scripts de seed y test webhook
✅ **`npm install` + `next build` corridos OK** — el repo compila limpio (verificado a las 09:00). Solo elimina y reinstala con `npm install` cuando despiertes; tarda ~2 min.

## Tu turno: 4 cosas en orden

### 1. Crear cuenta Supabase (5 min)
- https://supabase.com → New project (nombre: `meridian-engagement-ai`)
- Mientras provisiona (2 min), ve al paso 2

### 2. Generar las API keys (15 min)
- **Anthropic**: https://console.anthropic.com/settings/keys (mete $10 de crédito)
- **OpenAI**: https://platform.openai.com/api-keys (mete $5, solo embeddings)
- **ManyChat**: Settings → API → Generate Token (necesitas Pro = $15/mo)
- **Telegram** (opcional): @BotFather → /newbot

### 3. Configurar `.env.local` y correr la migración (10 min)
- Copia `.env.local.example` → `.env.local`, pega todas las keys
- Ve a Supabase → SQL Editor → pega `supabase/migrations/0001_initial_schema.sql` → Run
- Crea bucket `kb` en Storage (privado)

### 4. Probar y deployar (15 min)
```bash
cd /Users/MacBookair/meridian-engagement-ai
npm run dev
# abre http://localhost:3000/login → magic link → entra
```

Sube los PDFs de Meridian (blueprint_meridian_ES_v10, kpis_operativos_anexo) en `/knowledge-base`.

Cuando funcione local:
```bash
vercel link
vercel --prod
# Configura env vars en Vercel Dashboard
```

Wire ManyChat → webhook según `docs/MANYCHAT_INTEGRATION.md`.

## Ahorro vs el freelancer

| | Freelancer | Tú |
|---|---|---|
| Setup one-time | $2,500-5,000 | $0 |
| Mensual ops | depende | ~$110-210 |
| Multi-brand | extra $$$ | incluido |
| Lock-in | total | cero |

## Cuando despiertes, abre en este orden

1. Esta nota (`TOMORROW.md`)
2. `SPEC.md` (10 min de lectura — entiende qué construí)
3. `docs/SETUP.md` (síguelo paso a paso)
4. `docs/MANYCHAT_INTEGRATION.md` (cuando llegues al paso 11 de SETUP)

Cualquier error: chequea Vercel logs + Supabase logs. La sección "Common gotchas" al final de SETUP.md cubre los 5 problemas más probables.

Suerte 🚀
