# Architecture

## Request flow (sequence)

```
User      ManyChat       /api/manychat/webhook     /api/chat     Supabase     Claude API     OpenAI Embed     ManyChat API
 │           │                     │                  │             │              │              │              │
 │ DM ──────▶│                     │                  │             │              │              │              │
 │           │ POST ──────────────▶│                  │             │              │              │              │
 │           │                     │ verify HMAC      │             │              │              │              │
 │           │                     │ upsert sub ─────▶│             │              │              │              │
 │           │                     │ get/create conv ▶│             │              │              │              │
 │           │                     │ insert msg ─────▶│             │              │              │              │
 │           │                     │ check handoff ──▶│             │              │              │              │
 │           │ 200 OK ◀────────────│                  │             │              │              │              │
 │           │                     │ fetch→ /api/chat │             │              │              │              │
 │           │                     │                  │ load brand ▶│              │              │              │
 │           │                     │                  │ load hist ─▶│              │              │              │
 │           │                     │                  │ embed user msg ────────────────────────▶│              │
 │           │                     │                  │ pgvector top-K ▶            │              │              │
 │           │                     │                  │             │              │              │              │
 │           │                     │                  │ Claude w/ tools ─────────▶│              │              │
 │           │                     │                  │             │ ◀─────  reply (or tool_use) │              │
 │           │                     │                  │ (if tool: execute, loop back)            │              │
 │           │                     │                  │             │              │              │              │
 │           │                     │                  │ POST send ──────────────────────────────────────────────▶│
 │           │                     │                  │ insert assistant msg ─────▶│              │              │
 │           │ ◀── DM reply (from ManyChat to user) ─│                              │              │              │
 │ ◀─────────│                     │                  │             │              │              │              │
```

Latency target: **< 4 seconds end-to-end** for non-tool replies.

## Why the webhook returns 200 before Claude runs

ManyChat treats External Request as **synchronous** but with a 5s timeout. Claude can take 2–8s. So we:

1. Webhook acks the message quickly (just DB writes).
2. Fires `fetch('/api/chat')` without `await` — fire-and-forget.
3. `/api/chat` does the heavy lifting and sends the reply via ManyChat's API (not via webhook response).

This is the standard pattern for ManyChat + LLM systems.

## Why the brain is internal-only

`/api/chat` requires `x-internal-secret: $CRON_SECRET` header. Only the webhook (which knows the secret) can invoke it. This prevents:
- Rando spamming Claude on your dime
- Bypassing brand/account ownership checks

## Why prompt caching matters

The system prompt is ~3-5k tokens (base + voice + applied learnings).
Without caching: 5k tokens × $3/1M input × 60k turns/mo = **$900/mo just in system tokens**.
With caching (90% read discount): ~$90/mo.

Anthropic caches for 5 min. Since active conversations have turns close together, hit rate is high.

The retrieved RAG chunks are NOT cached (they vary per query) — fine, they're ~500 tokens.

## Why per-brand, not global

Multi-brand from day 1 is the moat:
- Same infra → second brand has near-zero marginal cost
- Selling to other agencies/brokers becomes a flip-the-switch op
- Even within Meridian, "brand" can mean "experiment" or "region" (Meridian-MX vs Meridian-AR)

Every query in code includes `brand_id`. RLS enforces it at the DB level even for honest mistakes.

## Why pgvector instead of a dedicated vector DB

| | pgvector in Supabase | Pinecone / Weaviate / Qdrant |
|---|---|---|
| Setup | 1 line in migration | separate account, separate index |
| Cost at our scale | included | $70+/mo |
| Joins with relational data | trivial | impossible / awkward |
| Performance up to ~1M chunks | excellent | excellent |
| Performance > 10M chunks | needs tuning | better |

Until we hit 10M chunks per brand, pgvector wins.

## Why nightly learning loop (not real-time)

Real-time prompt mutation is dangerous:
- Drift compounds within hours
- One bad insight can poison the system
- No human-in-the-loop = no accountability

Nightly + human-review hits the sweet spot: insights are fresh (≤24h old), reviewed by you, applied deliberately.

The Haiku model is used (not Sonnet) because it's 10× cheaper and "find the issue" is well within its capability.

## Why ManyChat (not custom Meta/WhatsApp APIs)

| | ManyChat | Direct Meta APIs |
|---|---|---|
| IG + FB + WA in one | yes | three different APIs |
| 24h messaging window enforcement | automatic | manual |
| Subscriber DB + custom fields | included | build yourself |
| Cost | $15/mo | $0 |
| Lock-in | medium | none |
| Time to MVP | hours | weeks |

$15/mo for the messaging plumbing is a great deal. We own the brain, so vendor lock is bounded.

## Failure modes & fallbacks

| Failure | Behavior |
|---|---|
| Claude API down | reply: "Déjame revisar eso y te respondo en breve" + log error |
| OpenAI embeddings down | RAG returns []; Claude answers from base knowledge only |
| ManyChat send fails | logged; assistant message still saved with note; manual retry possible |
| Supabase down | webhook returns 500; ManyChat shows fallback message to user |
| Unknown manychat_page_id | webhook returns 404; ops alerted via logs |

## Scaling notes

- IVFFlat index `lists = 100` is good up to ~100k chunks per brand. At 1M+, switch to HNSW.
- Webhook → /api/chat dispatch is currently in-process fetch. At 100+ req/sec, switch to a queue (Upstash QStash or Vercel KV-backed queue).
- Conversation table: at >10M rows, partition by month.
- Messages: at >100M rows, archive older than 90 days to cold storage.
