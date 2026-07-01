# ManyChat Integration

How to point a ManyChat account at the Meridian Engagement AI brain.

---

## Concept

ManyChat is the **messaging layer** — it handles delivery, history, broadcasts.
Your backend is the **brain** — it generates replies using Claude + RAG.

The flow:
1. User sends a DM on IG/WA/FB.
2. ManyChat catches it via a trigger ("Default Reply" for DMs, "Story Mention", etc.)
3. The trigger runs an **External Request** to your `/api/manychat/webhook`.
4. Your backend acknowledges fast (< 1s), then asynchronously dispatches `/api/chat`.
5. `/api/chat` calls Claude, runs tools, then sends the reply back via ManyChat's **Send Content API**.

This means ManyChat never waits for Claude — no timeouts.

---

## ManyChat-side configuration

### 1. Create a "AI Reply" flow

Automation → New Automation → **Trigger: Default Reply** (or whichever trigger).

Inside the flow, add a single **Action: External Request**:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `https://YOUR_DOMAIN.vercel.app/api/manychat/webhook` |
| Headers | `jorai: <MANYCHAT_WEBHOOK_SECRET>` |
| Body type | JSON |
| Body | (see below) |

### 2. JSON body template

Paste this exactly. Use ManyChat's custom-field picker to insert `{{...}}` tokens:

```json
{
  "manychat_page_id": "{{Page ID}}",
  "subscriber_id": "{{Subscriber ID}}",
  "subscriber": {
    "first_name": "{{First Name}}",
    "last_name": "{{Last Name}}",
    "full_name": "{{Full Name}}",
    "locale": "{{Locale}}",
    "timezone": "{{Timezone}}",
    "profile_pic": "{{Profile Pic URL}}"
  },
  "message": {
    "text": "{{Last Input Text}}",
    "type": "text"
  },
  "platform": "instagram"
}
```

Adjust `"platform"` per account: `instagram` / `facebook` / `whatsapp`.

### 3. Get the Page ID

After creating the External Request, **send a test** with any subscriber. Look in your Vercel logs for the value of `manychat_page_id` — that's what ManyChat reports as `{{Page ID}}`. Use it to insert into:

```sql
insert into manychat_accounts (brand_id, platform, display_name, manychat_api_key, manychat_page_id)
values (
  (select id from brands where slug = 'meridian'),
  'instagram',
  'Meridian IG',
  'PASTE_YOUR_MANYCHAT_API_TOKEN',
  'PASTE_THE_PAGE_ID_YOU_SAW_IN_LOGS'
);
```

### 3a. Test the webhook without ManyChat UI

Local manual payload:

```bash
APP_URL=http://localhost:3000 PAGE_ID=PASTE_PAGE_ID \
  npx tsx scripts/test-webhook.ts "Hola, quiero info de Meridian"
```

When testing the ManyChat UI through ngrok locally, set this in `.env.local`:

```env
INTERNAL_APP_URL=http://localhost:3000
```

ManyChat must call the public ngrok URL, but the local Next.js server should dispatch `/api/chat` through localhost.

Production full-contact payload, matching the current ManyChat template:

```bash
APP_URL=https://meridian-engagement-ai.vercel.app \
PAGE_ID=PASTE_PAGE_ID \
MANYCHAT_WEBHOOK_SECRET=PASTE_SECRET \
PAYLOAD_SHAPE=full_contact \
  npx tsx scripts/test-webhook.ts "Hola, quiero info de Meridian"
```

Expected result: HTTP 200 with `conversation_id`, a new dashboard conversation, and either a delivered reply or a visible delivery failure in the conversation detail.

### 4. Webhook authentication

In production, the webhook requires `MANYCHAT_WEBHOOK_SECRET`. Configure it in ManyChat as:

```
jorai: paste-your-MANYCHAT_WEBHOOK_SECRET-here
```

The route also accepts `x-webhook-secret` or `?secret=` for manual testing, but `jorai` is the recommended ManyChat header because some `x-...` headers are rejected by ManyChat.

---

## Handoff handling on the ManyChat side

When Claude calls `handoff_to_human`, the backend:
1. Updates the conversation status in Postgres.
2. Optionally adds the configured tag from `MANYCHAT_HANDOFF_TAG` to the subscriber via ManyChat API.
3. Sends a Telegram alert to ops.

In ManyChat, set up a **Smart Delay → Live Chat** rule:
- Trigger: tag added `MANYCHAT_HANDOFF_TAG` (for example `needs_human`)
- Action: open Live Chat conversation OR notify a specific user
- Optional: pause all automations for this subscriber until tag removed

Your ops team then handles the conversation directly inside ManyChat's Live Chat UI.

When done, an operator can:
- Remove the tag (re-enables AI) and the next DM will be AI-handled again, OR
- Mark the conversation closed in the dashboard (recommended for clean handoff history)

---

## Custom fields written back to ManyChat

The `save_lead_intent` tool writes these custom fields per subscriber:

| Field | Type | Example |
|---|---|---|
| `lead_score` | Number | `78` |
| `persona` | Text | `experienced` |
| `intent_type` | Text | `registration` |

Pre-create these fields in ManyChat → Settings → Custom Fields before the tool will succeed.

You can use these fields in ManyChat for:
- Tag-based broadcasts (e.g., everyone with `lead_score > 70`)
- Segmented Meta retargeting audiences
- Smart Delay rules (e.g., send a follow-up to `persona = newbie` after 3 days)

---

## Multi-account, same brand

A single brand can have multiple ManyChat accounts (IG + WA + FB). Each account gets its own row in `manychat_accounts` with its own API key + page ID. The webhook routes to the right brand based on incoming `manychat_page_id`.

### Replicate for another Instagram account

Ask the client for:

- ManyChat Pro access for the account
- ManyChat API token
- ManyChat Page ID
- Confirmation whether this account should use the existing `meridian` brand/persona or a separate brand prompt

For another account using the existing Meridian brain:

```bash
npm run account:upsert -- \
  --brand=meridian \
  --platform=instagram \
  --display="@deivin — Meridian" \
  --page-id=PASTE_PAGE_ID \
  --api-key=PASTE_MANYCHAT_API_TOKEN
```

Then replicate the same ManyChat automation:

1. Create/live-enable the AI reply flow.
2. Add External Request to `/api/manychat/webhook`.
3. Add header `jorai: <MANYCHAT_WEBHOOK_SECRET>`.
4. Use the same JSON body template.
5. Set it as Instagram Default Reply.
6. Send a real DM from a brand-new IG test account and verify a dashboard conversation appears.

## New brand, fresh deployment

Add a new brand:
1. Insert into `brands` with name + slug + system_prompt + voice + landing_base_url.
2. Insert into `brand_memberships` to give yourself access.
3. Insert into `manychat_accounts` with that brand's IG/WA/FB API keys.
4. Upload their PDFs via `/knowledge-base`.

Same webhook URL, no code change.
