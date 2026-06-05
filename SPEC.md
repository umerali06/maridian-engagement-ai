# SPEC.md — Meridian Engagement AI

> Conversational AI system for Meridian broker. Implements **Agent #4 — Engagement & Community Manager** from the Meridian agent architecture. Replaces the freelancer proposal with a self-built, owned, multi-brand-ready system.

---

## 0. North-star context

- **Business:** Meridian — trading broker launching in LATAM.
- **North-star goal:** $20B USD trading volume by year 2.
- **Funnel:** Followers → Registrations → Deposits → Volume.
- **This system's KPI ownership:**
  - **Primary:** Registrations from DM/comment → landing CTR (track UTMs the AI emits).
  - **Secondary:** Qualified leads passed to humans (handoff conversion rate).
  - **Hygiene:** Avg response time < 30s, sentiment > 0.6, escalations < 15%.

This system is **not** a generic chatbot. It is a trained Meridian persona that:
1. Answers product/regulatory/onboarding questions using Meridian's actual knowledge base.
2. Captures lead intent, segments by trader persona (newbie / experienced / Team Pro candidate).
3. Pushes warm leads to the landing page with personalized UTMs.
4. Hands off cleanly to a human when stakes warrant it (deposits, complaints, Team Pro).
5. Improves itself nightly by reviewing yesterday's transcripts.

---

## 1. Architecture (1-page diagram)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        USER (IG / WA / FB Messenger)                     │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ DMs, comments, story replies
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       ManyChat Pro ($15/mo)                              │
│  - Captures message, subscriber metadata, custom fields                  │
│  - Routes EVERYTHING to External Request → our /api/manychat/webhook     │
│  - Receives our reply via ManyChat Send Content API                      │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ POST { subscriber, message, account }
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js 16 on Vercel  —  meridian-engagement-ai.vercel.app              │
│  ┌────────────────────────┐  ┌─────────────────────────────────────────┐│
│  │ /api/manychat/webhook  │→ │ /api/chat (the BRAIN)                   ││
│  │  - verify signature    │  │  1. fetch subscriber + history          ││
│  │  - upsert subscriber   │  │  2. embed user msg → pgvector search    ││
│  │  - enqueue → /api/chat │  │  3. build context (system + KB + memory)││
│  └────────────────────────┘  │  4. Claude API (Sonnet 4.6 + caching)   ││
│                              │  5. handle tool calls (handoff, lead,   ││
│                              │     send_link, escalate)                 ││
│                              │  6. POST reply to ManyChat               ││
│                              │  7. log to messages table                ││
│                              └─────────────────────────────────────────┘│
│  ┌────────────────────────┐  ┌─────────────────────────────────────────┐│
│  │ /dashboard (admin UI)  │  │ /api/cron/learning-loop (daily 3am)     ││
│  │  - live conversations  │  │  - sample 50 convos from yesterday      ││
│  │  - knowledge base mgmt │  │  - Claude reviews → insights → learnings││
│  │  - brand switcher      │  │  - top 5 insights → editable suggestions││
│  │  - human takeover      │  │                                          ││
│  └────────────────────────┘  └─────────────────────────────────────────┘│
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Supabase (Postgres + pgvector + Auth + Storage)             │
│  brands · manychat_accounts · subscribers · conversations · messages     │
│  documents · document_chunks(vector 1536) · handoffs · learnings         │
└──────────────────────────────────────────────────────────────────────────┘

External APIs:
  - Anthropic Claude API (Sonnet 4.6 for replies, Haiku 4.5 for cheap tasks)
  - OpenAI Embeddings API (text-embedding-3-small, $0.02/1M tokens)
  - ManyChat Pro API (send messages back)
  - Telegram Bot API (handoff notifications to team)
```

---

## 2. Stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | **Next.js 16 (App Router)** on **Vercel** | One repo for dashboard + API routes. Edge/Node functions, cron built in. |
| Database | **Supabase Postgres** | Managed Postgres + pgvector + Auth + Storage. Free tier covers MVP. |
| Vector store | **pgvector inside Supabase** | Same DB, no extra service. 1536-dim cosine, IVFFlat index. |
| AI brain | **Claude Sonnet 4.6** via Anthropic SDK | Best reasoning/voice for B2C finance. Prompt caching on system prompt = 90% token savings. |
| Cheap tasks | **Claude Haiku 4.5** | Classification, summarization, learning loop. |
| Embeddings | **OpenAI text-embedding-3-small** | $0.02/1M tokens, 1536 dims, plenty for product knowledge. |
| Messaging layer | **ManyChat Pro** | IG/WA/FB Messenger in one. Webhook + Send Content API. $15/mo. |
| Auth | **Supabase Auth** (email magic link) | Built-in, no extra config. |
| File storage | **Supabase Storage** | For uploaded PDFs/docs. |
| PDF parsing | **`pdf-parse`** (npm) | Simple, no external service. |
| Notifications | **Telegram Bot** | Free, instant, group-friendly for handoff alerts. |
| UI library | **shadcn/ui + Tailwind v4** | Production-quality components, no vendor lock-in. |

**Total monthly infra cost at 10k conversations/month: ~$110–210.**

---

## 3. Data model (Supabase schema)

Full SQL in `supabase/migrations/0001_initial_schema.sql`. Key tables:

- **`brands`** — Multi-tenant root. Each brand has its own system prompt, voice guidelines, handoff config.
- **`manychat_accounts`** — A brand can have N accounts (IG + WA + FB). Each holds the ManyChat API key.
- **`subscribers`** — One row per ManyChat subscriber, scoped to brand. Holds custom fields.
- **`conversations`** — A session per subscriber (auto-closes after 24h idle). Tracks handoff state.
- **`messages`** — Every turn. Stores tokens, latency, cached tokens for cost tracking.
- **`documents`** + **`document_chunks`** — Knowledge base. Chunks hold the `vector(1536)` embedding.
- **`handoffs`** — Audit log of every escalation, with reason and resolution.
- **`learnings`** — Output of the nightly learning loop. Editable before applied to system prompt.

**Row-level security (RLS):** All dashboard tables filter by `brand_id` matching the authenticated user's accessible brands (via a `brand_memberships` table). Service role bypasses for webhook + cron.

---

## 4. The AI brain — request flow

```
ManyChat → /api/manychat/webhook (validates HMAC signature)
       → upsert subscriber, find/create conversation
       → POST internal /api/chat { conversation_id, message }
              │
              ├─ 1. Load last 20 messages (conversation memory)
              ├─ 2. Load brand system prompt + voice guidelines + applied learnings
              ├─ 3. Embed user message → pgvector top-5 chunks (RAG)
              ├─ 4. Build Claude request:
              │    - system: [base prompt + brand voice + learnings]  ← cached
              │    - documents: [retrieved chunks]                    ← cached per turn
              │    - messages: [history + new turn]
              │    - tools: [handoff_to_human, send_landing_link,
              │              save_lead_intent, schedule_callback]
              ├─ 5. Claude responds OR calls tool
              │    if tool: execute, then loop back to step 4 with tool_result
              ├─ 6. Store assistant message + token counts
              └─ 7. POST reply to ManyChat /fb/sending/sendContent
```

### Prompt caching strategy

System prompt + brand voice + applied learnings = **~3-5k tokens**, identical per turn.
With `cache_control: ephemeral` this hits the 5-min cache → **90% input cost reduction**.

Retrieved RAG chunks are **not** cached (they change per query) — that's fine, they're small.

### Tool definitions (initial set)

1. **`handoff_to_human(reason, urgency)`** — Marks conversation as handed off, sends Telegram alert to ops, replies with "te conecto con un humano".
2. **`send_landing_link(persona, utm_campaign)`** — Generates personalized landing URL with UTMs based on detected persona.
3. **`save_lead_intent(intent_type, score, notes)`** — Tags subscriber custom fields in ManyChat for retargeting.
4. **`schedule_callback(timeslot, contact_method)`** — Books a slot via Cal.com (future, Step 4).

---

## 5. Knowledge base ingestion

```
Dashboard /knowledge-base → DocumentUploader
  → POST /api/documents/upload (multipart, brand_id)
    → save file to Supabase Storage
    → pdf-parse → raw text
    → recursive chunker (~800 tokens, 100 overlap)
    → OpenAI embeddings (batch of 100)
    → insert into document_chunks
    → return count + preview
```

**Initial Meridian seed docs** (load on day 1):
- `blueprint_meridian_ES_v10.pdf` — Strategy, voice, content pillars
- `kpis_operativos_anexo.pdf` — KPIs and metrics
- Broker regulatory FAQ (to be drafted)
- Onboarding flow doc
- Team Pro program description
- Compliance disclaimers (mandatory in every reply about returns)

---

## 6. Learning loop (Step 3)

Runs nightly at **03:00 America/Mexico_City** via Vercel Cron.

```
1. Fetch yesterday's conversations (LIMIT 50, prioritize:
   handed_off + low-sentiment + long-but-no-conversion).
2. For each, send transcript to Claude Haiku 4.5 with reviewer prompt:
   "Identify: missed intents, factual gaps, tone misses, escalation patterns.
    Return JSON: { category, insight, severity, suggested_fix }"
3. Aggregate → cluster similar insights (cosine sim on insight embeddings)
4. Store top 10 clusters as `learnings` rows (applied=false)
5. Email/Telegram digest to admin: "5 new insights to review"
6. Admin reviews in /dashboard/learnings → checks "apply" → goes into system prompt
```

**Never auto-apply.** Human-in-the-loop prevents prompt drift and hallucinated rules.

---

## 7. Multi-brand replication (the killer feature)

Adding a new brand = **3 clicks**:

1. `/dashboard/brands/new` → name, slug, voice description.
2. Paste ManyChat API key + page ID for that brand.
3. Upload that brand's PDFs.

Behind the scenes:
- New `brands` row, new `manychat_accounts` row.
- ManyChat webhook URL is the same — `brand_id` is resolved from the incoming `page_id`.
- All queries already filter by `brand_id` (RLS + service code).

This is the moat: you can run **Meridian + 5 sister brokers + 10 unrelated clients** off the same infra at near-zero marginal cost.

---

## 8. Cost projections

**Per 10,000 conversations/month** (avg 6 turns each = 60k turns):

| Item | Est. cost |
|---|---|
| Claude Sonnet 4.6 input (with 90% caching, ~2k effective tokens/turn) | ~$36 |
| Claude Sonnet 4.6 output (~300 tokens/turn × 60k) | ~$90 |
| Claude Haiku 4.5 (learning loop, ~50 convs/day × 30) | ~$3 |
| OpenAI embeddings (60k queries + KB ingestion) | ~$2 |
| Supabase Pro | $25 |
| Vercel Pro | $20 |
| ManyChat Pro | $15 |
| **Total** | **~$191/mo** |

At 50k conversations/month, scales to ~$700/mo. Still 5–10× cheaper than enterprise chatbot tools (Intercom Fin, Ada, etc.).

---

## 9. Build order (this is the actual roadmap)

### Phase 1 — Infra & one-brand MVP (Days 1–2)
- [x] Repo scaffold (this delivery)
- [ ] Create Supabase project, run migration `0001_initial_schema.sql`
- [ ] Add env vars to Vercel
- [ ] Deploy skeleton to Vercel
- [ ] Configure ManyChat: one IG account → External Request → webhook URL
- [ ] Smoke test: send DM → see message in `messages` table → see reply

### Phase 2 — Knowledge base (Day 2)
- [ ] Login to dashboard with magic link
- [ ] Upload `blueprint_meridian_ES_v10.pdf`
- [ ] Verify chunks + embeddings in DB
- [ ] Send DM that needs RAG ("¿cuál es el spread mínimo?") → verify retrieval

### Phase 3 — Tools & handoff (Day 3)
- [ ] Implement `handoff_to_human` tool → Telegram alert
- [ ] Implement `send_landing_link` with UTMs
- [ ] Test handoff flow end-to-end with team

### Phase 4 — Learning loop (Day 4)
- [ ] Set up Vercel Cron at 03:00
- [ ] Build `/dashboard/learnings` review UI
- [ ] Run once manually, review output quality

### Phase 5 — Multi-brand + polish (Day 5)
- [ ] Brand switcher in dashboard header
- [ ] Add second test brand
- [ ] Rate limiting (Upstash Redis or Vercel KV)
- [ ] Sentry for error tracking
- [ ] Cost dashboard (sum tokens × price)

---

## 10. What we are NOT building (anti-scope)

- ❌ Voice/audio replies (ManyChat supports it; future iteration if needed)
- ❌ Image generation in replies (use ManyChat's image cards instead)
- ❌ Multi-language at launch — Spanish only (Meridian is LATAM-first)
- ❌ Fine-tuning a custom model — RAG + prompt + learnings is enough
- ❌ Custom auth UI — Supabase magic link out of the box
- ❌ Real-time websocket dashboard — polling every 5s is fine for MVP
- ❌ Workflow builder UI — system prompt + tools cover 95% of cases

---

## 11. Security & compliance

- **Webhook signature verification** — ManyChat HMAC, reject unsigned requests.
- **Service role key** — only in API routes, never in client.
- **RLS on every table** — even with a leaked anon key, no cross-brand reads.
- **PII** — subscribers store names, not financial data. No bank/card info ever in messages table (Claude is prompted to refuse).
- **Compliance disclaimers** — Mandatory boilerplate appended to any reply discussing returns/risk. Stored as a brand setting, enforced in prompt.
- **Audit log** — Every handoff is logged. Every learning application is logged.
- **Rate limit** — 30 messages/minute per subscriber. Above = silent drop + flag for review.

---

## 12. Open questions (to decide before Phase 4)

1. **Does Meridian want the AI to push deposits directly,** or always hand off the deposit conversation to a human for compliance?
2. **Telegram channel for handoffs:** one shared ops channel, or per-shift?
3. **Working hours behavior:** outside hours, does the AI promise "humano mañana" or just keep going?
4. **Team Pro qualification:** what custom fields exist in ManyChat today that we can read/write?

These can be deferred — system runs without answers, but answers improve conversion.

---

## 13. Files in this repo

```
SPEC.md                           ← this file
README.md                         ← quick overview
docs/SETUP.md                     ← step-by-step setup (do this tomorrow morning)
docs/MANYCHAT_INTEGRATION.md      ← ManyChat-side config (External Request, fields)
docs/ARCHITECTURE.md              ← deeper dive, sequence diagrams
docs/COSTS.md                     ← cost monitoring & alerts setup
.env.local.example                ← every env var documented
supabase/migrations/0001_initial_schema.sql   ← run this in Supabase SQL editor
src/app/api/manychat/webhook/route.ts         ← entry point
src/app/api/chat/route.ts                     ← the brain
src/app/api/documents/upload/route.ts         ← KB ingestion
src/app/api/cron/learning-loop/route.ts       ← nightly review
src/app/api/handoff/route.ts                  ← human takeover endpoint
src/app/(dashboard)/...                       ← admin UI
src/lib/ai/{claude,embeddings,rag,prompts,tools}.ts
src/lib/manychat/client.ts
src/lib/supabase/{client,server,admin}.ts
src/lib/chunking/pdf.ts
```

---

**Next action when you wake up:** open `docs/SETUP.md` and follow it top to bottom. ETA from zero to first working DM reply: ~90 minutes (most of it waiting for Vercel/Supabase provisioning).
