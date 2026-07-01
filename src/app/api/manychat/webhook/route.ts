import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeWebhookPayload, type ManyChatWebhookPayload } from "@/lib/manychat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDLE_THRESHOLD_HOURS = 24;
const DEFAULT_MESSAGES_PER_MINUTE = 30;

function safeEq(a: string | null, b: string): boolean {
  if (!a) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getInternalChatUrl(req: NextRequest) {
  const baseUrl =
    process.env.INTERNAL_APP_URL ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : req.nextUrl.origin);

  return new URL("/api/chat", baseUrl);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const trimmedBody = rawBody.trim();

  // Verify shared secret.
  // Skip in dev for easier local testing.
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (secret && process.env.NODE_ENV === "production") {
    const provided = req.headers.get("x-webhook-secret") ?? req.headers.get("jorai");
    if (!safeEq(provided, secret)) {
      console.warn("[webhook] invalid secret");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  if (!trimmedBody) {
    console.warn("[webhook] empty request body");
    return NextResponse.json({ ok: false, error: "empty body" }, { status: 400 });
  }

  let payload: ManyChatWebhookPayload;
  try {
    payload = JSON.parse(trimmedBody);
  } catch (e) {
    console.error("[webhook] invalid json:", trimmedBody.slice(0, 200), e);
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

  const minuteBucket = Math.floor(Date.now() / 60000);
  const idempotencyKey = createHash("sha256")
    .update(`${manychat_page_id}:${subscriber_id}:${message_text}:${minuteBucket}`)
    .digest("hex");

  const { error: dedupErr } = await supabase
    .from("webhook_dedup")
    .insert({ idempotency_key: idempotencyKey });

  if (dedupErr) {
    if (dedupErr.code === "23505") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error("[webhook] dedup insert error", dedupErr);
  }

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
        opted_in: true,
        last_interaction_at: new Date().toISOString(),
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

  if (process.env.UPSTASH_REDIS_REST_URL) {
    const { perSubscriberLimit, perIpLimit } = await import("@/lib/ratelimit");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const [subLim, ipLim] = await Promise.all([
      perSubscriberLimit.limit(subscriber_id),
      perIpLimit.limit(ip),
    ]);
    if (!subLim.success || !ipLim.success) {
      return NextResponse.json({ ok: true, rate_limited: true }, { status: 429 });
    }
  }

  // 3. Find the most recent conversation for this subscriber.
  // Reuse active threads, and also reuse handed-off threads so one Instagram user stays
  // attached to one conversation unless the thread was explicitly closed or went stale.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, last_message_at, status")
    .eq("subscriber_id", subRow.id)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  const now = Date.now();
  const idleMs = IDLE_THRESHOLD_HOURS * 3600 * 1000;

  const isFresh = existing && now - new Date(existing.last_message_at).getTime() < idleMs;

  if (existing && isFresh && existing.status !== "closed") {
    conversationId = existing.id;
  } else {
    if (existing && existing.status === "active") {
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

  const messagesPerMinute = Number(
    process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || DEFAULT_MESSAGES_PER_MINUTE,
  );
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { count: recentMessageCount, error: rateLimitErr } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .gte("created_at", oneMinuteAgo);

  if (rateLimitErr) {
    console.error("[webhook] rate limit check failed", rateLimitErr);
  } else if ((recentMessageCount || 0) >= messagesPerMinute) {
    console.warn("[webhook] rate limited conversation", conversationId);
    return NextResponse.json({
      ok: true,
      skipped: "rate_limited",
      conversation_id: conversationId,
    });
  }

  // 4. Log inbound message
  const { data: inboundMessage, error: msgErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      brand_id: account.brand_id,
      role: "user",
      content: message_text,
    })
    .select("id")
    .single();

  if (msgErr || !inboundMessage) {
    console.error("[webhook] insert message failed", msgErr);
    return NextResponse.json({ ok: false, error: "message insert failed" }, { status: 500 });
  }

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

  // 6. Dispatch to /api/chat after responding to ManyChat.
  const chatUrl = getInternalChatUrl(req);
  after(async () => {
    try {
      const res = await fetch(chatUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_id: inboundMessage.id,
          brand_id: account.brand_id,
          subscriber_id: subRow.id,
          manychat_subscriber_id: subscriber_id,
          manychat_api_key: account.manychat_api_key,
          platform: platform || account.platform,
          user_message: message_text,
        }),
      });
      if (!res.ok) console.error("[webhook] /api/chat non-2xx", res.status);
    } catch (e) {
      console.error("[webhook] /api/chat dispatch failed", e);
    }
  });

  return NextResponse.json({ ok: true, conversation_id: conversationId });
}
