import { randomUUID } from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic, MODEL_BRAIN } from "@/lib/ai/claude";
import { retrieve, formatChunksAsContext } from "@/lib/ai/rag";
import { buildSystemPrompt, buildCachedSystem, buildContextBlock } from "@/lib/ai/prompts";
import { TOOLS, buildLandingUrl, buildShortLandingUrl } from "@/lib/ai/tools";
import {
  OutOfMessagingWindowError,
  sendTextMessage,
  addTag,
  setCustomFields,
} from "@/lib/manychat/client";
import { sendSupervisorReview, sendTelegram } from "@/lib/telegram";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY_LIMIT = 20;
const MAX_TOOL_TURNS = 3;

type ChatRequest = {
  conversation_id: string;
  message_id?: string;
  brand_id: string;
  subscriber_id: string;
  manychat_subscriber_id: string;
  manychat_api_key: string;
  platform?: string;
  user_message: string;
};

type HistoryTurn = {
  id: string;
  role: string;
  content: string;
};

export async function POST(req: NextRequest) {
  // Internal-only endpoint
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ChatRequest;
  const supabase = createAdminClient();
  const t0 = Date.now();

  const locked = await tryAcquireConversationLock(supabase, body.conversation_id);
  if (!locked) {
    // Requeue rather than drop. The next call has a fresh 2s lock wait window.
    const retryCount = Number(req.headers.get("x-chat-retry") || 0);
    if (retryCount >= 3) {
      console.warn("[chat] conversation lock still busy after retries", body.conversation_id);
      return NextResponse.json({ ok: true, skipped: "conversation_locked" });
    }
    const chatUrl = new URL(req.url);
    after(async () => {
      try {
        await new Promise((r) => setTimeout(r, 5000 * (retryCount + 1)));
        await fetch(chatUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
            "x-chat-retry": String(retryCount + 1),
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        console.error("[chat] requeue failed", e);
      }
    });
    return NextResponse.json({ ok: true, queued: true, retry: retryCount + 1 });
  }

  try {
    return await processChat(body, supabase, t0);
  } finally {
    const { error } = await supabase.rpc("unlock_conversation", {
      conv_id: body.conversation_id,
    });
    if (error) console.error("[chat] unlock_conversation failed", body.conversation_id, error);
  }
}

async function processChat(
  body: ChatRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  t0: number,
) {
  // Load brand + applied learnings
  const { data: brand } = await supabase
    .from("brands")
    .select("name, system_prompt, voice_guidelines, mandatory_disclaimer, landing_base_url, rag_threshold, rag_top_k, fallback_handoff_message, fallback_landing_message_template, fallback_callback_message_template, fallback_callback_handoff_message, dedup_variants")
    .eq("id", body.brand_id)
    .single();
  if (!brand) {
    return NextResponse.json({ ok: false, error: "brand not found" }, { status: 404 });
  }
  const { data: learnings } = await supabase
    .from("learnings")
    .select("insight, suggested_fix")
    .eq("brand_id", body.brand_id)
    .eq("status", "applied")
    .limit(20);

  const systemText = buildSystemPrompt(brand, learnings || []);
  const systemBlocks = buildCachedSystem(systemText);

  // RAG retrieval
  const chunks = await retrieve(body.brand_id, body.user_message, {
    topK: brand.rag_top_k ?? 5,
    threshold: brand.rag_threshold ?? 0.45,
  });
  const ragContext = formatChunksAsContext(chunks);

  // History excluding the inbound message being processed; we re-add it explicitly with RAG context.
  // Fetch newest first so long conversations still surface the most recent context, then reverse for chronological order.
  const { data: history } = await supabase
    .from("messages")
    .select("id, role, content, tool_name, tool_input, tool_result")
    .eq("conversation_id", body.conversation_id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT + 1);

  const allHistory = ((history || []) as HistoryTurn[]).slice().reverse();
  const currentMessageIndex = body.message_id
    ? allHistory.findIndex((m) => m.id === body.message_id)
    : -1;
  const priorTurns =
    currentMessageIndex >= 0
      ? allHistory.slice(0, currentMessageIndex)
      : allHistory.slice(0, -1);

  const priorMessages: Anthropic.Messages.MessageParam[] = priorTurns.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  // Final user turn: context + actual message
  const finalUserText =
    (ragContext ? buildContextBlock(ragContext) + "\n\n" : "") + body.user_message;
  const messages = coalesceMessages([
    ...priorMessages,
    { role: "user", content: finalUserText },
  ]);

  // === Claude loop with tool execution ===
  let reply = "";
  let replyIsFromTool = false;
  let totalUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const toolActions: Array<{ name: string; input: unknown; result: unknown }> = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL_BRAIN,
      max_tokens: 600,
      system: systemBlocks,
      tools: TOOLS,
      messages,
    });

    totalUsage.input += resp.usage.input_tokens;
    totalUsage.output += resp.usage.output_tokens;
    totalUsage.cacheRead += resp.usage.cache_read_input_tokens || 0;
    totalUsage.cacheCreate += resp.usage.cache_creation_input_tokens || 0;

    if (resp.stop_reason === "tool_use") {
      const toolUses = resp.content.filter((c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use");
      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const { result, replyOverride } = await executeTool(
          tu.name,
          tu.input as Record<string, unknown>,
          { ...body, brand, supabase },
        );
        toolActions.push({ name: tu.name, input: tu.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
        if (replyOverride) {
          reply = replyOverride;
          replyIsFromTool = true;
        }
      }
      messages.push({ role: "user", content: toolResults });

      // If a tool produced its own user-facing message (handoff, send_link), we can stop.
      if (reply) break;
      continue;
    }

    // end_turn or max_tokens — extract text
    const textBlocks = resp.content.filter((c): c is Anthropic.Messages.TextBlock => c.type === "text");
    reply = textBlocks.map((b) => b.text).join("\n").trim();
    break;
  }

  if (!reply) {
    await sendTelegram(
      `⚠️ *Chat sin respuesta*\nconversation_id: ${body.conversation_id}`,
    );
    console.error("[chat] empty reply after tool loop", body.conversation_id);
    return NextResponse.json({ ok: true, skipped: "empty_reply" });
  }

  const debugSuffix =
    process.env.NODE_ENV !== "production"
      ? process.env.REPLY_DEBUG_SUFFIX?.trim()
      : undefined;
  const dedupedReply = replyIsFromTool
    ? reply
    : await avoidDuplicateReply(
        supabase,
        body.conversation_id,
        reply,
        brand.dedup_variants,
      );
  const replyToSend = debugSuffix ? `${dedupedReply} ${debugSuffix}` : dedupedReply;

  // === Send to ManyChat ===
  let deliveryStatus: "delivered" | "failed" = "delivered";
  let deliveryError: string | null = null;
  let deliveryResponse: unknown = null;
  const { data: subscriber } = await supabase
    .from("subscribers")
    .select("last_interaction_at")
    .eq("id", body.subscriber_id)
    .maybeSingle();

  try {
    if (process.env.HUMANIZE_TIMING !== "false") {
      // Human-like typing delay: real users type ~200 WPM = ~300ms/word.
      // Capped so delivery still lands within the messaging window comfortably.
      const wordCount = reply.split(/\s+/).filter(Boolean).length;
      const typingDelayMs = Math.min(15000, 1500 + wordCount * 300);
      await new Promise((r) => setTimeout(r, typingDelayMs));
    }

    if (process.env.SUPERVISOR_MODE === "true") {
      await sendSupervisorReview({
        conversationId: body.conversation_id,
        brandName: brand.name,
        userMessage: body.user_message,
        draftReply: replyToSend,
      });
      await supabase.from("messages").insert({
        conversation_id: body.conversation_id,
        brand_id: body.brand_id,
        role: "assistant",
        content: replyToSend,
        tokens_input: totalUsage.input,
        tokens_output: totalUsage.output,
        tokens_cache_read: totalUsage.cacheRead,
        tokens_cache_creation: totalUsage.cacheCreate,
        latency_ms: Date.now() - t0,
        model: MODEL_BRAIN,
        delivery_status: "pending",
        delivery_error: null,
        delivered_at: null,
      });
      return NextResponse.json({ ok: true, supervisor_mode: true });
    }

    deliveryResponse = await sendTextMessage({
      apiKey: body.manychat_api_key,
      subscriberId: body.manychat_subscriber_id,
      platform: body.platform,
      text: replyToSend,
      lastInteractionAt: subscriber?.last_interaction_at,
    });
  } catch (e) {
    if (e instanceof OutOfMessagingWindowError) {
      await sendTelegram(
        `⚠️ *Reply fuera de ventana 24h*\nconversation_id: ${body.conversation_id}`,
      );
      console.warn("[chat] skipped send outside messaging window", body.conversation_id);
      return NextResponse.json({ ok: true, skipped: "outside_messaging_window" });
    }
    console.error("[chat] manychat send failed", e);
    deliveryStatus = "failed";
    deliveryError = e instanceof Error ? e.message : String(e);
  }

  // === Persist assistant message ===
  const latency = Date.now() - t0;
  await supabase.from("messages").insert({
    conversation_id: body.conversation_id,
    brand_id: body.brand_id,
    role: "assistant",
    content: replyToSend,
    tool_input: toolActions.length > 0 || deliveryResponse ? { toolActions, deliveryResponse } : null,
    tokens_input: totalUsage.input,
    tokens_output: totalUsage.output,
    tokens_cache_read: totalUsage.cacheRead,
    tokens_cache_creation: totalUsage.cacheCreate,
    latency_ms: latency,
    model: MODEL_BRAIN,
    delivery_status: deliveryStatus,
    delivery_error: deliveryError,
    delivered_at: deliveryStatus === "delivered" ? new Date().toISOString() : null,
  });

  return NextResponse.json({ ok: true, reply: replyToSend, latency_ms: latency, delivery_status: deliveryStatus });
}

async function tryAcquireConversationLock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conversationId: string,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc("try_lock_conversation", {
      conv_id: conversationId,
    });
    if (error) {
      console.error("[chat] try_lock_conversation failed", conversationId, error);
      return false;
    }
    if (data) return true;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function avoidDuplicateReply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conversationId: string,
  reply: string,
  variants: string[] | null,
) {
  const { data: lastAssistant } = await supabase
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastAssistant?.content || lastAssistant.content !== reply) {
    return reply;
  }

  const activeVariants =
    variants && variants.length > 0
      ? variants
      : [
          "Si no te abre, te lo vuelvo a pasar.",
          "Si te atoras en el proceso, me dices.",
          "Si quieres, te explico cuál te conviene.",
        ];
  const index =
    Math.abs(hashString(conversationId + reply + Date.now().toString())) %
    activeVariants.length;
  return `${reply} ${activeVariants[index]}`;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function coalesceMessages(
  messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
  const coalesced: Anthropic.Messages.MessageParam[] = [];

  for (const message of messages) {
    const previous = coalesced[coalesced.length - 1];
    if (
      previous &&
      previous.role === message.role &&
      typeof previous.content === "string" &&
      typeof message.content === "string"
    ) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      coalesced.push(message);
    }
  }

  return coalesced;
}

// =========================================================================
// Tool executor
// =========================================================================
type ToolCtx = ChatRequest & {
  brand: {
    name: string;
    landing_base_url: string | null;
    fallback_handoff_message: string | null;
    fallback_landing_message_template: string | null;
    fallback_callback_message_template: string | null;
    fallback_callback_handoff_message: string | null;
    dedup_variants: string[] | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<{ result: unknown; replyOverride?: string }> {
  switch (name) {
    case "handoff_to_human": {
      const reason = String(input.reason);
      const urgency = String(input.urgency || "normal");
      const userMsg = String(
        input.user_message_to_send ||
          ctx.brand.fallback_handoff_message ||
          "Te conecto con alguien del equipo 🙌",
      );
      const handoffTag = process.env.MANYCHAT_HANDOFF_TAG?.trim();

      await ctx.supabase
        .from("conversations")
        .update({
          status: "handed_off",
          handoff_reason: reason,
          handed_off_at: new Date().toISOString(),
        })
        .eq("id", ctx.conversation_id);

      await ctx.supabase.from("handoffs").insert({
        conversation_id: ctx.conversation_id,
        brand_id: ctx.brand_id,
        reason,
        urgency,
        triggered_by: "ai",
      });

      // Telegram alert
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/conversations/${ctx.conversation_id}`;
      await sendTelegram(
        `🚨 *Handoff* (${urgency})\n*${ctx.brand.name}*\nRazón: ${reason}\n[Abrir conversación](${dashboardUrl})`,
      );

      // Tag the subscriber in ManyChat only when the workspace has a known handoff tag configured.
      if (handoffTag) {
        try {
          await addTag(ctx.manychat_api_key, ctx.manychat_subscriber_id, handoffTag);
        } catch (e) {
          console.error(`[tool handoff] addTag failed for tag "${handoffTag}"`, e);
        }
      } else {
        console.warn("[tool handoff] MANYCHAT_HANDOFF_TAG not configured; falling back to custom field");
      }

      // Always mirror handoff state to a custom field so Live Chat operators can filter.
      try {
        await setCustomFields(ctx.manychat_api_key, ctx.manychat_subscriber_id, {
          handoff_status: "pending",
          handoff_reason: reason.slice(0, 200),
          handoff_urgency: urgency,
        });
      } catch (e) {
        console.error("[tool handoff] setCustomFields failed", e);
      }

      return { result: { ok: true }, replyOverride: userMsg };
    }

    case "send_landing_link": {
      const persona = String(input.persona || "general");
      const utm_campaign = String(input.utm_campaign || "manychat_dm");
      const utm_content = input.utm_content ? String(input.utm_content) : undefined;
      const messageTemplate = String(
        input.message ||
          ctx.brand.fallback_landing_message_template ||
          "Aquí tienes 👉 {LINK}",
      );

      const base = ctx.brand.landing_base_url || process.env.NEXT_PUBLIC_LANDING_BASE_URL!;
      const destinationUrl = buildLandingUrl(base, persona, utm_campaign, utm_content);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || base;
      const nonce = randomUUID();
      await ctx.supabase.from("short_link_nonces").insert({
        nonce,
        brand_id: ctx.brand_id,
        subscriber_id: ctx.subscriber_id,
        conversation_id: ctx.conversation_id,
        persona,
        utm_campaign,
        utm_content,
      });
      const shortUrl = buildShortLandingUrl(appUrl, nonce);
      const finalMsg = messageTemplate.replace("{LINK}", shortUrl);

      await ctx.supabase.from("lead_events").insert({
        brand_id: ctx.brand_id,
        subscriber_id: ctx.subscriber_id,
        conversation_id: ctx.conversation_id,
        event_type: "link_sent",
        persona,
        utm_campaign,
        utm_content,
        payload: { url: destinationUrl, short_url: shortUrl },
      });

      return { result: { url: destinationUrl, short_url: shortUrl }, replyOverride: finalMsg };
    }

    case "save_lead_intent": {
      const intent_type = String(input.intent_type);
      const score = Number(input.score || 0);
      const persona = input.persona ? String(input.persona) : null;
      const notes = String(input.notes || "");

      await ctx.supabase
        .from("subscribers")
        .update({
          detected_persona: persona,
          lead_score: score,
        })
        .eq("id", ctx.subscriber_id);

      await ctx.supabase.from("lead_events").insert({
        brand_id: ctx.brand_id,
        subscriber_id: ctx.subscriber_id,
        conversation_id: ctx.conversation_id,
        event_type: "intent_captured",
        persona,
        score,
        payload: { intent_type, notes },
      });

      // Mirror to ManyChat custom fields for retargeting
      try {
        await setCustomFields(ctx.manychat_api_key, ctx.manychat_subscriber_id, {
          lead_score: score,
          persona: persona || "general",
          intent_type,
        });
      } catch (e) {
        console.error("[tool save_lead_intent] setCustomFields failed", e);
      }

      return { result: { ok: true } };
    }

    case "schedule_callback": {
      const preferredTime = String(input.preferred_time || "");
      const contactMethod = String(input.contact_method || "instagram");
      const notes = String(input.notes || "");
      const messageTemplate = String(
        input.message ||
          ctx.brand.fallback_callback_message_template ||
          "Agenda aquí y el equipo te da seguimiento: {LINK}",
      );
      const bookingUrl = process.env.CALLBACK_BOOKING_URL;

      await ctx.supabase.from("lead_events").insert({
        brand_id: ctx.brand_id,
        subscriber_id: ctx.subscriber_id,
        conversation_id: ctx.conversation_id,
        event_type: "callback_requested",
        payload: {
          preferred_time: preferredTime,
          contact_method: contactMethod,
          notes,
          booking_url_configured: Boolean(bookingUrl),
        },
      });

      if (bookingUrl) {
        const url = new URL(bookingUrl);
        url.searchParams.set("utm_source", "manychat");
        url.searchParams.set("utm_medium", "dm");
        url.searchParams.set("utm_campaign", "callback_request");
        if (preferredTime) url.searchParams.set("preferred_time", preferredTime);
        url.searchParams.set("contact_method", contactMethod);

        return {
          result: { ok: true, url: url.toString() },
          replyOverride: messageTemplate.replace("{LINK}", url.toString()),
        };
      }

      await ctx.supabase
        .from("conversations")
        .update({
          status: "handed_off",
          handoff_reason: "Callback requested but CALLBACK_BOOKING_URL is not configured",
          handed_off_at: new Date().toISOString(),
        })
        .eq("id", ctx.conversation_id);

      await ctx.supabase.from("handoffs").insert({
        conversation_id: ctx.conversation_id,
        brand_id: ctx.brand_id,
        reason: "Callback requested; booking URL not configured",
        urgency: "normal",
        triggered_by: "ai",
      });

      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/conversations/${ctx.conversation_id}`;
      await sendTelegram(
        `📞 *Callback solicitado*\n*${ctx.brand.name}*\nHorario: ${preferredTime || "no indicado"}\nCanal: ${contactMethod}\nNotas: ${notes || "—"}\n[Abrir conversación](${dashboardUrl})`,
      );

      return {
        result: { ok: true, handed_off: true },
        replyOverride:
          ctx.brand.fallback_callback_handoff_message ||
          "Te conecto con alguien del equipo para coordinar la llamada. Te responden por aquí en breve 🤝",
      };
    }

    default:
      return { result: { error: `unknown tool: ${name}` } };
  }
}
