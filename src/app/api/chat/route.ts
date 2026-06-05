import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic, MODEL_BRAIN } from "@/lib/ai/claude";
import { retrieve, formatChunksAsContext } from "@/lib/ai/rag";
import { buildSystemPrompt, buildCachedSystem, buildContextBlock } from "@/lib/ai/prompts";
import { TOOLS, buildLandingUrl } from "@/lib/ai/tools";
import { sendTextMessage, addTag, setCustomFields } from "@/lib/manychat/client";
import { sendTelegram } from "@/lib/telegram";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY_LIMIT = 20;
const MAX_TOOL_TURNS = 3;

type ChatRequest = {
  conversation_id: string;
  brand_id: string;
  subscriber_id: string;
  manychat_subscriber_id: string;
  manychat_api_key: string;
  user_message: string;
};

export async function POST(req: NextRequest) {
  // Internal-only endpoint
  const internalSecret = req.headers.get("x-internal-secret");
  if (internalSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ChatRequest;
  const supabase = createAdminClient();
  const t0 = Date.now();

  // Load brand + applied learnings
  const { data: brand } = await supabase
    .from("brands")
    .select("name, system_prompt, voice_guidelines, mandatory_disclaimer, landing_base_url")
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
  const chunks = await retrieve(body.brand_id, body.user_message, { topK: 5, threshold: 0.45 });
  const ragContext = formatChunksAsContext(chunks);

  // History (last N excluding the just-inserted user message; we re-add it explicitly)
  const { data: history } = await supabase
    .from("messages")
    .select("role, content, tool_name, tool_input, tool_result")
    .eq("conversation_id", body.conversation_id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT + 1);

  // Build Anthropic messages, skipping the most-recent inserted user row (we'll inject with context)
  const priorTurns = (history || []).slice(0, -1);
  const messages: Anthropic.Messages.MessageParam[] = priorTurns.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  // Final user turn: context + actual message
  const finalUserText =
    (ragContext ? buildContextBlock(ragContext) + "\n\n" : "") + body.user_message;
  messages.push({ role: "user", content: finalUserText });

  // === Claude loop with tool execution ===
  let reply = "";
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
        if (replyOverride) reply = replyOverride;
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
    reply = "Déjame revisar eso y te respondo en breve 🙏";
  }

  // === Send to ManyChat ===
  try {
    await sendTextMessage({
      apiKey: body.manychat_api_key,
      subscriberId: body.manychat_subscriber_id,
      text: reply,
    });
  } catch (e) {
    console.error("[chat] manychat send failed", e);
  }

  // === Persist assistant message ===
  const latency = Date.now() - t0;
  await supabase.from("messages").insert({
    conversation_id: body.conversation_id,
    brand_id: body.brand_id,
    role: "assistant",
    content: reply,
    tool_input: toolActions.length > 0 ? toolActions : null,
    tokens_input: totalUsage.input,
    tokens_output: totalUsage.output,
    tokens_cache_read: totalUsage.cacheRead,
    tokens_cache_creation: totalUsage.cacheCreate,
    latency_ms: latency,
    model: MODEL_BRAIN,
  });

  return NextResponse.json({ ok: true, reply, latency_ms: latency });
}

// =========================================================================
// Tool executor
// =========================================================================
type ToolCtx = ChatRequest & {
  brand: { name: string; landing_base_url: string | null };
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
      const userMsg = String(input.user_message_to_send || "Te conecto con alguien del equipo 🙌");

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

      // Tag the subscriber in ManyChat so the team's Live Chat picks it up
      try {
        await addTag(ctx.manychat_api_key, ctx.manychat_subscriber_id, "needs_human");
      } catch (e) {
        console.error("[tool handoff] addTag failed", e);
      }

      return { result: { ok: true }, replyOverride: userMsg };
    }

    case "send_landing_link": {
      const persona = String(input.persona || "general");
      const utm_campaign = String(input.utm_campaign || "manychat_dm");
      const utm_content = input.utm_content ? String(input.utm_content) : undefined;
      const messageTemplate = String(input.message || "Aquí tienes 👉 {LINK}");

      const base = ctx.brand.landing_base_url || process.env.NEXT_PUBLIC_LANDING_BASE_URL!;
      const url = buildLandingUrl(base, persona, utm_campaign, utm_content);
      const finalMsg = messageTemplate.replace("{LINK}", url);

      await ctx.supabase.from("lead_events").insert({
        brand_id: ctx.brand_id,
        subscriber_id: ctx.subscriber_id,
        conversation_id: ctx.conversation_id,
        event_type: "link_sent",
        persona,
        utm_campaign,
        utm_content,
        payload: { url },
      });

      return { result: { url }, replyOverride: finalMsg };
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

    default:
      return { result: { error: `unknown tool: ${name}` } };
  }
}
