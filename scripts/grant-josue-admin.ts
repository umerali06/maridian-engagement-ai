/**
 * Find Josue's auth.user (by email) and grant him admin membership of the meridian brand.
 * Run with: npx tsx scripts/grant-josue-admin.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local manually
const env = readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const EMAIL = "josue@trademeridian.co";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // 1. Find the user
  const { data: users, error: usersErr } = await supabase.auth.admin.listUsers();
  if (usersErr) throw usersErr;
  const user = users.users.find((u) => u.email === EMAIL);
  if (!user) {
    console.error(`No user found with email ${EMAIL}. Log in first via /login (magic link).`);
    process.exit(1);
  }
  console.log(`✓ Found user: ${user.id} (${user.email})`);

  // 2. Find brand
  const { data: brand } = await supabase.from("brands").select("id, name").eq("slug", "meridian").single();
  if (!brand) {
    console.error("Brand 'meridian' not found");
    process.exit(1);
  }
  console.log(`✓ Brand: ${brand.name} (${brand.id})`);

  // 3. Upsert membership
  const { error: memErr } = await supabase
    .from("brand_memberships")
    .upsert({ user_id: user.id, brand_id: brand.id, role: "admin" }, { onConflict: "user_id,brand_id" });
  if (memErr) throw memErr;

  console.log(`✓ Josue granted admin of '${brand.name}'`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
