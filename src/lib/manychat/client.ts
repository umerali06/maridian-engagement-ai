/**
 * Minimal ManyChat API wrapper.
 * Docs: https://api.manychat.com/swagger
 */

const API_BASE = "https://api.manychat.com";

export type ManyChatSendOptions = {
  apiKey: string;
  subscriberId: string;
  text: string;
  messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
  tag?: string;
};

export async function sendTextMessage({
  apiKey,
  subscriberId,
  text,
  messagingType = "RESPONSE",
  tag,
}: ManyChatSendOptions) {
  const body = {
    subscriber_id: subscriberId,
    data: {
      version: "v2",
      content: {
        messages: [{ type: "text", text }],
      },
    },
    message_tag: tag,
    messaging_type: messagingType,
  };

  const res = await fetch(`${API_BASE}/fb/sending/sendContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ManyChat send failed (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function setCustomFields(
  apiKey: string,
  subscriberId: string,
  fields: Record<string, string | number | boolean>,
) {
  const fieldArray = Object.entries(fields).map(([field_name, field_value]) => ({
    field_name,
    field_value,
  }));
  const res = await fetch(`${API_BASE}/fb/subscriber/setCustomFields`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscriber_id: subscriberId, fields: fieldArray }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ManyChat setCustomFields failed (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function addTag(apiKey: string, subscriberId: string, tagName: string) {
  const res = await fetch(`${API_BASE}/fb/subscriber/addTagByName`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscriber_id: subscriberId, tag_name: tagName }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ManyChat addTag failed (${res.status}): ${errText}`);
  }
  return res.json();
}

/** Verifies HMAC signature from ManyChat External Request (if configured). */
export async function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare
  if (hex.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hex.length; i++) mismatch |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}
