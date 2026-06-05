/**
 * Sends a fake ManyChat webhook payload to your local /api/manychat/webhook.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 PAGE_ID=YOUR_MC_PAGE_ID tsx scripts/test-webhook.ts "¿cuál es el spread mínimo?"
 */

const appUrl = process.env.APP_URL || "http://localhost:3000";
const pageId = process.env.PAGE_ID || "REPLACE_WITH_MANYCHAT_PAGE_ID";
const message = process.argv[2] || "Hola, quiero saber más de Meridian";

async function main() {
  const payload = {
    manychat_page_id: pageId,
    subscriber_id: "test-sub-" + Math.floor(Math.random() * 1000),
    subscriber: {
      first_name: "Test",
      last_name: "User",
      full_name: "Test User",
      locale: "es_MX",
      timezone: "America/Mexico_City",
    },
    message: { text: message, type: "text" },
    platform: "instagram",
  };

  console.log("POST", `${appUrl}/api/manychat/webhook`);
  console.log("payload:", payload);

  const r = await fetch(`${appUrl}/api/manychat/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("status:", r.status);
  console.log("body:", await r.text());
}
main();
