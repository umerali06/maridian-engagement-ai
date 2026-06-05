# Meridian AI — Project Status

**Goal:** Self-built AI that auto-replies to all DMs on Instagram (@josue.melero) using Claude API. Selling Meridian (trading broker). Eventually replicate across multiple brand accounts.

---

## Stack

- **Next.js 15** on Vercel — handles webhooks + admin dashboard
- **Supabase** (Postgres + pgvector) — conversations, subscribers, knowledge base, embeddings
- **Claude Sonnet 4.6** (Anthropic) — the AI brain, with prompt caching
- **OpenAI text-embedding-3-small** — embeddings for RAG
- **ManyChat Pro** — messaging layer between IG and our backend
- **Telegram bot** — handoff alerts

Repo: `/Users/MacBookair/meridian-engagement-ai/`
Production URL: `https://meridian-engagement-ai.vercel.app`
Supabase project ref: `uphaywzjygpyusoldcnq`
ManyChat IG page id: `3559151` (account "Trading Fx", Pro)

---

## What works ✅

- Backend deployed, all env vars set in Vercel
- Supabase schema migrated (brands, subscribers, conversations, messages, documents, document_chunks, handoffs, learnings, lead_events, brand_memberships)
- 153 chunks seeded into KB from 13 Meridian/trading docs (blueprint, founder positioning, Swiss Code, FVG guide, etc.)
- System prompt: Josué's first-person voice, anti-guru, knows Smart Money / Swiss Code / liquidity pools
- Admin dashboard with login, conversations, KB uploader
- Pipeline tested end-to-end via direct curl → backend → Claude → response (~6s latency)
- **ManyChat "Test Request" of the External Request hits backend with HTTP 200**, creates conversation, Claude responds
- ManyChat config in place:
  - Flow `MERIDIAN AI AGENT` is LIVE
  - Trigger: "El usuario envía un mensaje" with 10+ keywords (hola, hi, ?, info, meridian, trader, broker, etc.)
  - Action: External Request → `POST https://meridian-engagement-ai.vercel.app/api/manychat/webhook`
  - Header: `jorai: <secret>` (custom name because ManyChat rejected `x-webhook-secret`)
  - Body: `{"page_id":"3559151","platform":"instagram","contact":{{subscriber_data|to_json:true}},"message_text":"{{last_input_text}}"}`
  - Set as Instagram **Default Reply**
  - 3 Ice Breakers configured, all link to MERIDIAN AI AGENT
  - Inbox behavior: "La conversación debe abrirse explícitamente" enabled

---

## What does NOT work ❌

**Real Instagram DMs don't trigger the flow.** ManyChat receives them (they appear in the Inbox) but the External Request never fires.

Concrete observations:
- Flow shows 4 executions, all from manual curl tests, zero from real DMs.
- A friend with no prior conversation history with @josue.melero opened the chat — saw Instagram's native Ice Breakers (not ManyChat's). Tapping one did NOT trigger the flow.
- The native IG Ice Breakers were deactivated. Waiting to test again with the ManyChat ones now visible.
- DM "Quiero hacer trading" and "hola, info de meridian" from existing follower @lamercadologa.nat → both arrived in ManyChat Inbox, neither triggered any flow.

---

## What we've tried (in order)

1. Set the flow as Instagram **Default Reply** — done, still doesn't trigger for real DMs
2. Changed Inbox Behavior to "Conversación debe abrirse explícitamente" — done, no change
3. Configured 3 Ice Breakers in ManyChat pointing to MERIDIAN AI AGENT — done
4. Disabled Instagram-native Ice Breakers — done (just now)
5. Tested External Request directly from ManyChat (Test button) — **works, returns 200, creates conversation**
6. Direct curl with exact ManyChat payload → backend processes, Claude replies (~9s) — works

---

## Open hypotheses

1. **Instagram opt-in restriction**: Instagram requires explicit opt-in for businesses to auto-reply. Subscribers who opted in via comment-to-DM growth tools (like Natalia, opted in 2022 via "Post or Reel Comments #3") may not be opted in for general DM automation. ManyChat's Default Reply may not fire for non-opted-in conversations.
2. **Handover Protocol**: @josue.melero might be configured in Meta Business with another app as primary receiver, not ManyChat.
3. **24-hour messaging window**: Messages outside the window may bypass automations.
4. **Cache**: IG might be slow to reflect ManyChat Ice Breaker changes.

---

## Secondary bug (low priority right now)

When two near-simultaneous DMs arrive on the same conversation, Claude responds with the fallback message ("Déjame revisar eso y te respondo en breve 🙏") instead of a real reply. Suspected cause: race condition in `/api/chat` — history loaded with 2 user turns in a row → Anthropic API may reject. Fix: serialize per-conversation processing or properly merge concurrent messages.

---

## Next step (currently testing)

After deactivating IG-native Ice Breakers, asking the friend to:
- Close + reopen the chat with @josue.melero
- Confirm that ManyChat's 3 Ice Breakers now show
- Tap one
- Check if backend receives the request and AI replies

If this works → all new users go through opt-in via Ice Breaker, then Default Reply takes over for subsequent DMs.

If it doesn't → likely Meta Business Suite / handover protocol issue, need to verify ManyChat is the primary messaging app for @josue.melero on Meta Business.

---

## Repo files of interest

- `SPEC.md` — full architecture
- `supabase/migrations/0001_initial_schema.sql` — DB schema
- `src/app/api/manychat/webhook/route.ts` — entry point from ManyChat
- `src/app/api/chat/route.ts` — the Claude AI brain
- `src/lib/manychat/types.ts` — normalizes ManyChat's "subscriber_data|to_json:true" payload
- `src/lib/ai/prompts.ts` — system prompt (Josué voice)
- `.env.local` — keys (Supabase, Anthropic, OpenAI, Telegram, ManyChat secret = `jorai` header value)

---

## TL;DR for the friend

Backend works. ManyChat config looks right. But real IG DMs don't trigger the flow — they land in Inbox without firing any automation. Pipeline is proven via curl + ManyChat Test Request. The blocker is purely on the IG ↔ ManyChat trigger side — likely an opt-in / handover-protocol / Meta Business app permissions issue. Need someone who knows ManyChat IG quirks deep.
