/**
 * Sends a fake ManyChat webhook payload to your local /api/manychat/webhook.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 PAGE_ID=YOUR_MC_PAGE_ID npx tsx scripts/test-webhook.ts "¿cuál es el spread mínimo?"
 *
 * Production:
 *   APP_URL=https://meridian-engagement-ai.vercel.app PAGE_ID=YOUR_MC_PAGE_ID \
 *   MANYCHAT_WEBHOOK_SECRET=YOUR_SECRET SUBSCRIBER_ID=REAL_MANYCHAT_SUBSCRIBER_ID \
 *   npx tsx scripts/test-webhook.ts "Hola"
 */

const appUrl = process.env.APP_URL || "http://localhost:3000";
const pageId = process.env.PAGE_ID || "REPLACE_WITH_MANYCHAT_PAGE_ID";
const subscriberIdFromEnv = process.env.SUBSCRIBER_ID;
const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
const message = process.argv[2] || "Hola, quiero saber más de Meridian";
const payloadShape = process.env.PAYLOAD_SHAPE || "manual";

async function main() {
  const subscriberId = subscriberIdFromEnv || "test-sub-" + Math.floor(Math.random() * 1000);
  const payload =
    payloadShape === "full_contact"
      ? {
          page_id: pageId,
          platform: "instagram",
          contact: {
            id: subscriberId,
            page_id: pageId,
            first_name: "Test",
            last_name: "User",
            name: "Test User",
            locale: "es_MX",
            timezone: "America/Mexico_City",
          },
          message_text: message,
        }
      : {
          manychat_page_id: pageId,
          subscriber_id: subscriberId,
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
  console.log("payload shape:", payloadShape);
  console.log("payload:", payload);

  const r = await fetch(`${appUrl}/api/manychat/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { jorai: secret } : {}),
    },
    body: JSON.stringify(payload),
  });
  console.log("status:", r.status);
  console.log("body:", await r.text());
}
main();
