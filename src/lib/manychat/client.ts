/**
 * Minimal ManyChat API wrapper.
 * Docs: https://api.manychat.com/swagger
 */

const API_BASE = "https://api.manychat.com";
const SEND_RETRY_DELAYS_MS = [1000, 3000];
const RESPONSE_WINDOW_MS = 24 * 3600 * 1000;

export class OutOfMessagingWindowError extends Error {
  constructor(lastInteractionAt: string) {
    super(`Cannot send RESPONSE outside 24h messaging window: ${lastInteractionAt}`);
    this.name = "OutOfMessagingWindowError";
  }
}

export type ManyChatSendOptions = {
  apiKey: string;
  subscriberId: string;
  platform?: string;
  text: string;
  messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
  tag?: string;
  lastInteractionAt?: string | null;
};

export async function sendTextMessage({
  apiKey,
  subscriberId,
  platform = "instagram",
  text,
  messagingType = "RESPONSE",
  tag,
  lastInteractionAt,
}: ManyChatSendOptions) {
  if (
    messagingType === "RESPONSE" &&
    lastInteractionAt &&
    Date.now() - new Date(lastInteractionAt).getTime() > RESPONSE_WINDOW_MS
  ) {
    throw new OutOfMessagingWindowError(lastInteractionAt);
  }

  const contentType =
    platform === "instagram" || platform === "facebook" || platform === "whatsapp"
      ? platform
      : "instagram";
  const body = {
    subscriber_id: subscriberId,
    data: {
      version: "v2",
      content: {
        type: contentType,
        messages: [{ type: "text", text }],
      },
    },
    message_tag: tag,
    messaging_type: messagingType,
  };

  const res = await fetchWithRetry(`${API_BASE}/fb/sending/sendContent`, {
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

async function fetchWithRetry(url: string, init: RequestInit) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= SEND_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!shouldRetryStatus(res.status) || attempt === SEND_RETRY_DELAYS_MS.length) {
        return res;
      }

      await sleep(SEND_RETRY_DELAYS_MS[attempt]);
    } catch (error) {
      lastError = error;
      if (attempt === SEND_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await sleep(SEND_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

function shouldRetryStatus(status: number) {
  return status === 429 || status >= 500;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
