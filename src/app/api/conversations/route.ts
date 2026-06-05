import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brand_id");
  const status = url.searchParams.get("status");

  let q = supabase
    .from("conversations")
    .select("id, brand_id, subscriber_id, status, last_message_at, message_count, summary, subscribers(full_name, profile_pic, platform)")
    .order("last_message_at", { ascending: false })
    .limit(50);
  if (brandId) q = q.eq("brand_id", brandId);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data });
}
