import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic, MODEL_CHEAP } from "@/lib/ai/claude";
import { buildReviewerPrompt } from "@/lib/ai/prompts";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAMPLE_SIZE = 50;

export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // Get active brands
  const { data: brands } = await supabase.from("brands").select("id, name").eq("active", true);
  if (!brands?.length) return NextResponse.json({ ok: true, skipped: "no brands" });

  const summary: Array<{ brand: string; insights: number }> = [];

  for (const brand of brands) {
    // Sample yesterday's conversations: prioritize handed_off + long ones
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, status, message_count")
      .eq("brand_id", brand.id)
      .gte("created_at", since)
      .order("message_count", { ascending: false })
      .limit(SAMPLE_SIZE);

    if (!convs?.length) {
      summary.push({ brand: brand.name, insights: 0 });
      continue;
    }

    let insightCount = 0;

    for (const conv of convs) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (!msgs?.length) continue;

      const orderedMsgs = msgs.slice().reverse();
      const transcript = orderedMsgs
        .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
        .join("\n");

      try {
        const resp = await anthropic.messages.create({
          model: MODEL_CHEAP,
          max_tokens: 1500,
          messages: [{ role: "user", content: buildReviewerPrompt(transcript) }],
        });
        const text = resp.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("\n")
          .trim();

        // Best-effort JSON parse (strip code fences)
        const jsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
        const parsed = JSON.parse(jsonText) as {
          issues?: Array<{
            category: string;
            insight: string;
            severity: string;
            suggested_fix: string;
          }>;
        };

        for (const issue of parsed.issues || []) {
          await supabase.from("learnings").insert({
            brand_id: brand.id,
            category: issue.category,
            insight: issue.insight,
            severity: issue.severity,
            suggested_fix: issue.suggested_fix,
            example_conversation_ids: [conv.id],
          });
          insightCount++;
        }
      } catch (e) {
        console.error("[learning-loop] reviewer failed for conv", conv.id, e);
      }
    }

    summary.push({ brand: brand.name, insights: insightCount });
  }

  // Notify
  if (summary.some((s) => s.insights > 0)) {
    const lines = summary.map((s) => `• ${s.brand}: ${s.insights} insights`).join("\n");
    await sendTelegram(
      `🧠 *Learning loop completado*\n${lines}\n\nRevisa en el dashboard → /learnings`,
    );
  }

  return NextResponse.json({ ok: true, summary });
}
