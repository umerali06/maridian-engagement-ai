import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeWebhookPayload, type ManyChatWebhookPayload } from "@/lib/manychat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDLE_THRESHOLD_HOURS = 24;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify shared secret. ManyChat rejects some custom headers,
  // so we accept via header `x-webhook-secret`, header `jorai`, or query `?secret=`.
  // Skip in dev for easier local testing.
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (secret && process.env.NODE_ENV === "production") {
    const headerXVal = req.headers.get("x-webhook-secret");
    const headerJoraiVal = req.headers.get("jorai");
    const queryVal = new URL(req.url).searchParams.get("secret");
    if (headerXVal !== secret && headerJoraiVal !== secret && queryVal !== secret) {
      console.warn("[webhook] invalid secret");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: ManyChatWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("[webhook] invalid json:", rawBody.slice(0, 200), e);
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const norm = normalizeWebhookPayload(payload);
  if (!norm) {
    console.error("[webhook] could not normalize payload:", JSON.stringify(payload).slice(0, 500));
    return NextResponse.json({ ok: false, error: "missing required fields" }, { status: 400 });
  }
  const {
    manychat_page_id,
    subscriber_id,
    message_text,
    platform,
    first_name,
    last_name,
    full_name,
    profile_pic,
    locale,
    timezone,
  } = norm;

  const supabase = createAdminClient();

  // 1. Resolve account → brand
  const { data: account, error: acctErr } = await supabase
    .from("manychat_accounts")
    .select("id, brand_id, manychat_api_key, platform")
    .eq("manychat_page_id", manychat_page_id)
    .eq("active", true)
    .maybeSingle();

  if (acctErr || !account) {
    console.error("[webhook] unknown manychat_page_id", manychat_page_id, acctErr);
    return NextResponse.json({ ok: false, error: "unknown account" }, { status: 404 });
  }

  // 2. Upsert subscriber
  const { data: subRow, error: subErr } = await supabase
    .from("subscribers")
    .upsert(
      {
        brand_id: account.brand_id,
        manychat_account_id: account.id,
        manychat_subscriber_id: subscriber_id,
        platform: platform || account.platform,
        full_name,
        first_name,
        last_name,
        profile_pic,
        locale,
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brand_id,manychat_subscriber_id" },
    )
    .select("id")
    .single();

  if (subErr || !subRow) {
    console.error("[webhook] upsert subscriber failed", subErr);
    return NextResponse.json({ ok: false, error: "subscriber upsert failed" }, { status: 500 });
  }

  // 3. Find or create active conversation (idle > 24h closes it)
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, last_message_at, status")
    .eq("subscriber_id", subRow.id)
    .eq("status", "active")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  const now = Date.now();
  const idleMs = IDLE_THRESHOLD_HOURS * 3600 * 1000;

  if (existing && now - new Date(existing.last_message_at).getTime() < idleMs) {
    conversationId = existing.id;
  } else {
    if (existing) {
      await supabase.from("conversations").update({ status: "closed" }).eq("id", existing.id);
    }
    const { data: newConv, error: convErr } = await supabase
      .from("conversations")
      .insert({
        brand_id: account.brand_id,
        subscriber_id: subRow.id,
      })
      .select("id")
      .single();
    if (convErr || !newConv) {
      console.error("[webhook] create conversation failed", convErr);
      return NextResponse.json({ ok: false, error: "conversation create failed" }, { status: 500 });
    }
    conversationId = newConv.id;
  }

  // 4. Log inbound message
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    brand_id: account.brand_id,
    role: "user",
    content: message_text,
  });

  // 5. Check if conversation is handed off — if so, do nothing (humans took over)
  const { data: convStatus } = await supabase
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .single();

  if (convStatus?.status === "handed_off") {
    // ManyChat will keep the convo silent for AI; humans handle via Live Chat there
    return NextResponse.json({ ok: true, skipped: "handed_off" });
  }

  // 6. Fire-and-forget to /api/chat (don't block ManyChat webhook timeout)
  const chatUrl = new URL("/api/chat", req.url);
  fetch(chatUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.CRON_SECRET || "",
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      brand_id: account.brand_id,
      subscriber_id: subRow.id,
      manychat_subscriber_id: subscriber_id,
      manychat_api_key: account.manychat_api_key,
      user_message: message_text,
    }),
  }).catch((e) => console.error("[webhook] /api/chat dispatch failed", e));

  return NextResponse.json({ ok: true, conversation_id: conversationId });
}
