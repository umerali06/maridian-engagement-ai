# Meridian Engagement AI

Custom conversational AI for Meridian (and any other brand). Runs as the brain behind ManyChat — handles DMs on Instagram, WhatsApp and Messenger, retrieves answers from a per-brand knowledge base, captures lead intent, hands off cleanly to humans, and improves itself nightly.

This is the self-built replacement for the freelancer proposal — same architecture, owned end-to-end, **~$110–210/mo** to operate.

---

## What's in here

- **`SPEC.md`** — Full architecture, data model, roadmap, costs. Start here if you've never seen this repo.
- **`docs/SETUP.md`** — Step-by-step setup. Do this first thing tomorrow morning. ~90 min from zero to first working DM reply.
- **`docs/MANYCHAT_INTEGRATION.md`** — How to configure ManyChat side: External Request, custom fields, Live Chat handoff.
- **`docs/ARCHITECTURE.md`** — Deeper dive on request flow + sequence diagrams.
- **`docs/COSTS.md`** — Cost monitoring and projection.

---

## Stack at a glance

- **Next.js 15** (App Router) on **Vercel** — one repo, API + dashboard
- **Supabase** — Postgres + pgvector + Auth + Storage
- **Anthropic Claude** (Sonnet 4.6 brain + Haiku 4.5 cheap tasks) with prompt caching
- **OpenAI** text-embedding-3-small for RAG
- **ManyChat Pro** as the messaging layer
- **Telegram Bot** for handoff alerts

---

## Quick start

```bash
cp .env.local.example .env.local
# fill in keys per docs/SETUP.md

npm install
npm run dev                 # http://localhost:3000

# When ready to ship:
vercel link
vercel env pull
vercel --prod
```

---

## Repo layout

```
SPEC.md                     ← architecture doc
docs/                       ← setup, integration, cost docs
supabase/migrations/        ← run 0001_initial_schema.sql in Supabase
src/
  app/
    api/manychat/webhook/   ← entrypoint from ManyChat
    api/chat/               ← the AI brain (Claude + RAG + tools)
    api/documents/upload/   ← KB ingestion (PDF→chunks→embeddings)
    api/cron/learning-loop/ ← nightly self-improvement
    api/handoff/            ← human takeover endpoint
    (dashboard)/            ← admin UI
  lib/
    supabase/               ← client, server, admin
    ai/                     ← claude, embeddings, rag, prompts, tools
    manychat/               ← API wrapper + types
    chunking/               ← PDF parsing + chunker
scripts/
  seed-meridian-knowledge.ts  ← bulk-load PDFs
  test-webhook.ts             ← simulate a ManyChat call
vercel.json                 ← cron config
```
