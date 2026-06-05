/**
 * Generate a magic-link URL for Josue without sending an email
 * (bypasses Supabase's free-tier 3-emails-per-hour limit).
 *
 * Usage: npx tsx scripts/generate-login-link.ts <email>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: npx tsx scripts/generate-login-link.ts <email>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // 1. Make sure the user exists (create if not)
  const { data: list } = await supabase.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    user = created.user!;
    console.log(`✓ Created user ${user.id}`);
  } else {
    console.log(`✓ User already exists: ${user.id}`);
  }

  // 2. Generate a magic link (does NOT send an email when using admin.generateLink)
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error) throw error;

  console.log("\n=== ABRE ESTE LINK EN TU BROWSER ===\n");
  console.log(data.properties.action_link);
  console.log("\n=====================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
