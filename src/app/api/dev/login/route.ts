/**
 * DEV-ONLY: mints a session for a given email by hitting Supabase admin.generateLink
 * and immediately following the verification redirect server-side, so the session
 * cookie is set on this domain without an email roundtrip.
 *
 * Gated by NODE_ENV !== "production" AND a shared secret (CRON_SECRET) in the URL.
 *
 * Visit: http://localhost:3000/api/dev/login?email=josue@trademeridian.co&secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev-only endpoint" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const secret = searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "bad secret" }, { status: 401 });
  }
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Ensure the user exists
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    user = created.user!;
  }

  // 2. Generate a fresh magic-link token
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  const tokenHash = link.properties.hashed_token;

  // 3. Verify it server-side to mint a session in OUR cookies
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) {
    return NextResponse.json({ error: verifyErr.message }, { status: 500 });
  }

  // Success — redirect to dashboard with session cookie set
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
