import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLandingUrl } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const nonce = req.nextUrl.searchParams.get("n");
  const base = process.env.NEXT_PUBLIC_LANDING_BASE_URL;

  if (!base) {
    return NextResponse.json(
      { ok: false, error: "landing base URL not configured" },
      { status: 500 },
    );
  }

  if (!nonce) {
    // No nonce - fall back to generic landing to avoid a broken redirect.
    return NextResponse.redirect(buildLandingUrl(base, "general", "manychat_dm"), {
      status: 302,
    });
  }

  const supabase = createAdminClient();
  const { data: nonceRow } = await supabase
    .from("short_link_nonces")
    .select("brand_id, subscriber_id, conversation_id, persona, utm_campaign, utm_content")
    .eq("nonce", nonce)
    .maybeSingle();

  if (!nonceRow) {
    return NextResponse.redirect(buildLandingUrl(base, "general", "manychat_dm"), {
      status: 302,
    });
  }

  // Mark the click and log the lead event. Do not block redirect on failure.
  const clickedAt = new Date().toISOString();
  await Promise.all([
    supabase
      .from("short_link_nonces")
      .update({ clicked_at: clickedAt })
      .eq("nonce", nonce)
      .is("clicked_at", null),
    supabase.from("lead_events").insert({
      brand_id: nonceRow.brand_id,
      subscriber_id: nonceRow.subscriber_id,
      conversation_id: nonceRow.conversation_id,
      event_type: "link_clicked",
      persona: nonceRow.persona,
      utm_campaign: nonceRow.utm_campaign,
      utm_content: nonceRow.utm_content,
      payload: { nonce, clicked_at: clickedAt },
    }),
  ]).catch((e) => console.error("[/r] click log failed", e));

  const destination = buildLandingUrl(
    base,
    nonceRow.persona,
    nonceRow.utm_campaign,
    nonceRow.utm_content || undefined,
  );
  return NextResponse.redirect(destination, { status: 302 });
}
