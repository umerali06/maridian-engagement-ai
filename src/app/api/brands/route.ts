import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** List brands the current user belongs to. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("brands")
    .select("id, slug, name, active, landing_base_url")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brands: data });
}

/** Create a new brand and add the current user as admin member. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { slug, name, system_prompt, voice_guidelines, landing_base_url } = await req.json();
  if (!slug || !name) return NextResponse.json({ error: "slug+name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: brand, error } = await admin
    .from("brands")
    .insert({ slug, name, system_prompt, voice_guidelines, landing_base_url })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("brand_memberships").insert({ user_id: user.id, brand_id: brand.id, role: "admin" });

  return NextResponse.json({ ok: true, brand_id: brand.id });
}
