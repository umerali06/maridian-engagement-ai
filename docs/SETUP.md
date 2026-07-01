# Setup — do this first

ETA: ~90 minutes (most of it waiting for Vercel/Supabase to provision). Follow top to bottom.

---

## 1. Local install

```bash
cd /Users/MacBookair/meridian-engagement-ai
npm install
cp .env.local.example .env.local
```

You'll fill `.env.local` as you go through the next steps.

---

## 2. Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Name: `meridian-engagement-ai`. Region: pick closest to your users (likely `us-east-1` or `sa-east-1`).
3. Save the database password somewhere safe.
4. Wait ~2 min for provisioning.

### 2a. Get keys
Settings → API:
- Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- Copy **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Copy **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ never expose to browser
- Copy the project ref (the part before `.supabase.co`) → `SUPABASE_PROJECT_ID`

### 2b. Run the schema migrations
Database → SQL Editor → New query → run every file in `supabase/migrations/` in numeric order:

1. `0001_initial_schema.sql`
2. `0002_message_delivery_status.sql`

You should see "Success. No rows returned" — that's expected. It also seeds a default `meridian` brand.

### 2c. Create the Storage bucket for KB files
Storage → New bucket:
- Name: `kb`
- Public: **NO** (private)

### 2d. Add yourself as a brand admin
Run in SQL Editor (replace the email):

```sql
insert into brand_memberships (user_id, brand_id, role)
select u.id, b.id, 'admin'
from auth.users u, brands b
where u.email = 'josue@trademeridian.co' and b.slug = 'meridian'
on conflict do nothing;
```

Note: the user must have logged in at least once before this works. So either:
- (a) Log in once via `/login` first to create the auth.user row, then run the SQL.
- (b) Manually create the user in Authentication → Users → Add user → "Send invite", then run the SQL.

---

## 3. Anthropic API key

1. https://console.anthropic.com/settings/keys → **Create key**.
2. Add credits (start with $10 — that's ~50k turns of conversation).
3. Copy → `ANTHROPIC_API_KEY` in `.env.local`.

---

## 4. OpenAI API key (for embeddings only)

1. https://platform.openai.com/api-keys → **Create new secret key**.
2. Restrict to "Embeddings" only (project settings).
3. Add $5 of credit (will last months for embeddings).
4. Copy → `OPENAI_API_KEY` in `.env.local`.

---

## 5. ManyChat Pro

1. https://manychat.com → Upgrade to Pro ($15/mo) for any account you want to connect.
2. Settings → API → **Generate Token**. Copy.
3. Settings → API → note the **Page ID**.

You'll store these per-account in Supabase, not in env vars. After Vercel is up, do:

```sql
insert into manychat_accounts (brand_id, platform, display_name, manychat_api_key, manychat_page_id)
select b.id, 'instagram', 'Meridian IG', 'PASTE_API_KEY_HERE', 'PASTE_PAGE_ID_HERE'
from brands b where b.slug = 'meridian';
```

### Webhook secret (optional but recommended for prod)
Generate a random string and set:
```
MANYCHAT_WEBHOOK_SECRET=$(openssl rand -hex 32)
```
Configure the same secret in ManyChat External Request settings (see `MANYCHAT_INTEGRATION.md`).

Optional spend guard:
```
RATE_LIMIT_MESSAGES_PER_MINUTE=30
```
This ignores extra inbound messages above the limit for the same active conversation within one minute.

Optional handoff tag:
```env
MANYCHAT_HANDOFF_TAG=needs_human
```
Create the same tag in ManyChat first. If left blank, handoffs still work, but the backend skips tagging the contact.

---

## 6. Telegram bot (optional — for handoff alerts)

1. Open Telegram → search `@BotFather` → `/newbot`. Choose a name, get the token.
2. Create a group "Meridian Ops" → add the bot → make it admin.
3. Send a test message in the group, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Grab the `chat.id` (negative number for groups).
4. Set in `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_OPS_CHAT_ID=-100...
   ```

---

## 7. Cron secret

```bash
# Generate one:
openssl rand -hex 32
```
Set `CRON_SECRET=<the value>` in `.env.local`.

### Optional callback booking link

If you use Cal.com or another booking page, set:

```env
CALLBACK_BOOKING_URL=https://cal.com/your-team/meridian-call
```

When Claude uses `schedule_callback`, the AI sends this link with UTM parameters and logs a `callback_requested` lead event. If this env var is empty, callback requests become human handoffs instead.

---

## 8. Test locally

```bash
npm run dev
```

Open http://localhost:3000/login → enter your email → click the magic link in your inbox.

You should land on `/dashboard` with empty stats. ✓

### Smoke test the webhook

In another terminal:

```bash
APP_URL=http://localhost:3000 PAGE_ID=<your-manychat-page-id> \
  npx tsx scripts/test-webhook.ts "Hola, ¿cuánto es el spread mínimo?"
```

Check `/dashboard` — you should see a new conversation appear within a few seconds.

---

## 9. Seed Meridian knowledge base

Drop the Meridian docs in the repo somewhere and run:

```bash
npx tsx scripts/seed-meridian-knowledge.ts \
  /path/to/blueprint_meridian_ES_v10.pdf \
  /path/to/kpis_operativos_anexo.pdf
```

Or use the UI: `/knowledge-base` → upload via the form.

Verify in Supabase: `select count(*) from document_chunks;` should return > 0.

### Scanned PDFs / OCR

Normal PDFs are parsed locally with `pdf-parse`. Scanned PDFs need OCR because they contain page images instead of selectable text.

Configure an OCR service only if scanned PDFs must be ingested:

```env
OCR_HTTP_ENDPOINT=https://your-ocr-service.example.com/extract
OCR_HTTP_TOKEN=optional-shared-secret
```

The OCR service contract is:

```http
POST /extract
Authorization: Bearer <OCR_HTTP_TOKEN>
Content-Type: application/json
```

Request:

```json
{
  "filename": "scanned.pdf",
  "mime_type": "application/pdf",
  "file_base64": "..."
}
```

Response:

```json
{ "text": "full extracted text here" }
```

If `OCR_HTTP_ENDPOINT` is not configured and a PDF has no extractable text, upload returns: `no text extracted; configure OCR_HTTP_ENDPOINT for scanned PDFs`.

---

## 10. Deploy to Vercel

```bash
npm i -g vercel    # if needed
vercel link        # answer the prompts: create new project, import this dir
```

In the Vercel Dashboard → Project Settings → Environment Variables → paste every var from `.env.local`.

```bash
vercel --prod
```

Note the deployment URL (e.g. `meridian-engagement-ai.vercel.app`). Set this as `NEXT_PUBLIC_APP_URL` in Vercel env vars AND redeploy:

```bash
vercel --prod
```

---

## 11. Wire up ManyChat → Vercel webhook

See `docs/MANYCHAT_INTEGRATION.md` for the exact ManyChat flow config. Short version:

1. ManyChat → Automation → Default Reply (or any trigger) → External Request
2. URL: `https://meridian-engagement-ai.vercel.app/api/manychat/webhook`
3. Method: POST
4. Body: JSON with `manychat_page_id`, `subscriber_id`, `subscriber`, `message`, `platform`
5. Header: `jorai: <MANYCHAT_WEBHOOK_SECRET>`
6. Save → Send Test

---

## 12. You're live

Send a real DM to the connected IG account. Within ~3 seconds you should see:
- A new conversation in `/dashboard`
- A reply arriving in DM

If something breaks, check Vercel logs (`vercel logs --follow`) and Supabase logs.

---

## Common gotchas

- **`pgvector` not installed**: re-run the migration — it has `create extension if not exists vector`.
- **RLS blocks SELECT in dashboard**: did you add yourself to `brand_memberships`?
- **Webhook returns 404 "unknown account"**: the `manychat_page_id` you sent doesn't match any row in `manychat_accounts`. Insert one.
- **No reply arrives in IG but DB has the message**: check that the per-account `manychat_api_key` is valid and IG account is connected in ManyChat.
- **Cron doesn't fire**: Vercel Cron only runs on Pro plans. The schedule in `vercel.json` is UTC.
