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
| Headers | `Content-Type: application/json` |
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

### 4. (Recommended) HMAC signing

Add an extra header in External Request:

```
x-manychat-signature: {{external_request_body_hmac_sha256}}
```

(ManyChat doesn't natively compute HMAC of the body, so this is currently optional. If you want hard auth, gate the webhook by IP allowlist or a static `x-secret-header` instead.)

For a simpler approach, add:

```
x-secret: paste-your-CRON_SECRET-here
```

And in `webhook/route.ts`, also check this header. The repo currently uses HMAC; you can adapt.

---

## Handoff handling on the ManyChat side

When Claude calls `handoff_to_human`, the backend:
1. Updates the conversation status in Postgres.
2. Adds a tag `needs_human` to the subscriber via ManyChat API.
3. Sends a Telegram alert to ops.

In ManyChat, set up a **Smart Delay → Live Chat** rule:
- Trigger: tag added `needs_human`
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

## New brand, fresh deployment

Add a new brand:
1. Insert into `brands` with name + slug + system_prompt + voice + landing_base_url.
2. Insert into `brand_memberships` to give yourself access.
3. Insert into `manychat_accounts` with that brand's IG/WA/FB API keys.
4. Upload their PDFs via `/knowledge-base`.

Same webhook URL, no code change.
