import { NextRequest, NextResponse } from "next/server";
import { buildLandingUrl } from "@/lib/ai/tools";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const persona = req.nextUrl.searchParams.get("persona") || "general";
  const utmCampaign = req.nextUrl.searchParams.get("utm_campaign") || "manychat_dm";
  const utmContent = req.nextUrl.searchParams.get("utm_content") || undefined;
  const base = process.env.NEXT_PUBLIC_LANDING_BASE_URL;

  if (!base) {
    return NextResponse.json({ ok: false, error: "landing base URL not configured" }, { status: 500 });
  }

  const destination = buildLandingUrl(base, persona, utmCampaign, utmContent);
  return NextResponse.redirect(destination, { status: 302 });
}
