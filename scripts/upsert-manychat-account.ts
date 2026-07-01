/**
 * Add or update a ManyChat account for an existing brand.
 *
 * Usage:
 *   npx tsx scripts/upsert-manychat-account.ts \
 *     --brand=meridian \
 *     --platform=instagram \
 *     --display="@deivin — Meridian" \
 *     --page-id=123456 \
 *     --api-key=PASTE_MANYCHAT_API_TOKEN
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

type Args = {
  brand?: string;
  platform?: string;
  display?: string;
  pageId?: string;
  apiKey?: string;
};

function loadEnv() {
  const env = readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

function parseArgs(): Args {
  const parsed: Args = {};

  for (const rawArg of process.argv.slice(2)) {
    const [rawKey, ...rawValueParts] = rawArg.split("=");
    const value = rawValueParts.join("=");
    const key = rawKey.replace(/^--/, "");

    if (key === "brand") parsed.brand = value;
    if (key === "platform") parsed.platform = value;
    if (key === "display") parsed.display = value;
    if (key === "page-id") parsed.pageId = value;
    if (key === "api-key") parsed.apiKey = value;
  }

  return parsed;
}

function requireArg(name: keyof Args, value: string | undefined): string {
  if (!value) {
    console.error(`Missing --${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
    process.exit(1);
  }

  return value;
}

function maskSecret(secret: string) {
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

async function main() {
  loadEnv();
  const args = parseArgs();
  const brandSlug = requireArg("brand", args.brand);
  const platform = requireArg("platform", args.platform);
  const displayName = requireArg("display", args.display);
  const pageId = requireArg("pageId", args.pageId);
  const apiKey = requireArg("apiKey", args.apiKey);

  if (!["instagram", "facebook", "whatsapp", "telegram", "sms"].includes(platform)) {
    console.error("--platform must be one of: instagram, facebook, whatsapp, telegram, sms");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("slug", brandSlug)
    .single();

  if (brandError || !brand) {
    console.error(`Brand not found: ${brandSlug}`);
    if (brandError) console.error(brandError.message);
    process.exit(1);
  }

  const { data: account, error: accountError } = await supabase
    .from("manychat_accounts")
    .upsert(
      {
        brand_id: brand.id,
        platform,
        display_name: displayName,
        manychat_api_key: apiKey,
        manychat_page_id: pageId,
        active: true,
      },
      { onConflict: "manychat_page_id" },
    )
    .select("id, display_name, platform, manychat_page_id, active")
    .single();

  if (accountError || !account) {
    console.error("Failed to upsert ManyChat account");
    if (accountError) console.error(accountError.message);
    process.exit(1);
  }

  console.log("✓ ManyChat account upserted");
  console.log(`Brand: ${brand.name} (${brand.slug})`);
  console.log(`Account: ${account.display_name}`);
  console.log(`Platform: ${account.platform}`);
  console.log(`Page ID: ${account.manychat_page_id}`);
  console.log(`API key: ${maskSecret(apiKey)}`);
  console.log(`Active: ${account.active}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
