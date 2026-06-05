import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Manual handoff actions from the dashboard.
 * POST { conversation_id, action: 'takeover' | 'resolve' | 'return_to_ai', notes? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { conversation_id, action, notes } = await req.json();

  if (!conversation_id || !action) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // RLS will enforce brand membership on the select
  const { data: conv, error } = await supabase
    .from("conversations")
    .select("id, brand_id, status")
    .eq("id", conversation_id)
    .single();
  if (error || !conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "takeover") {
    await supabase
      .from("conversations")
      .update({
        status: "handed_off",
        handed_off_at: new Date().toISOString(),
        handed_off_to: user.email,
      })
      .eq("id", conversation_id);
    await supabase.from("handoffs").insert({
      conversation_id,
      brand_id: conv.brand_id,
      reason: notes || "manual takeover",
      triggered_by: "manual",
    });
  } else if (action === "resolve") {
    await supabase
      .from("handoffs")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        notes,
      })
      .eq("conversation_id", conversation_id)
      .eq("resolved", false);
    await supabase.from("conversations").update({ status: "closed" }).eq("id", conversation_id);
  } else if (action === "return_to_ai") {
    await supabase
      .from("conversations")
      .update({ status: "active", handoff_reason: null, handed_off_at: null, handed_off_to: null })
      .eq("id", conversation_id);
  } else {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
