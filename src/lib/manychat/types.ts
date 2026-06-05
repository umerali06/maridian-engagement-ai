/**
 * Two supported payload shapes from ManyChat External Request.
 *
 * Shape A — manual JSON with variable placeholders (legacy):
 *   { manychat_page_id, subscriber_id, subscriber: {...}, message: { text }, platform }
 *
 * Shape B — Full Contact + last_input_text (what ManyChat's UI generates today):
 *   { page_id, platform, contact: <full_contact_data>, message_text: <last_input_text> }
 */
export type ManyChatWebhookPayload = {
  manychat_page_id?: string;
  page_id?: string;
  platform?: "instagram" | "facebook" | "whatsapp";

  // Shape A
  subscriber_id?: string;
  subscriber?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    profile_pic?: string;
    locale?: string;
    timezone?: string;
    custom_fields?: Record<string, string | number | boolean>;
  };
  message?: {
    text: string;
    type?: string;
    attachment_url?: string;
  };

  // Shape B (Full Contact)
  contact?: {
    id?: string | number;
    page_id?: string | number;
    user_refs?: unknown;
    first_name?: string;
    last_name?: string;
    name?: string;
    profile_pic?: string;
    locale?: string;
    timezone?: string;
    custom_fields?: Record<string, unknown>;
    [k: string]: unknown;
  };
  message_text?: string;
  last_input_text?: string;
};

/**
 * Normalize either shape into a single canonical inbound message.
 */
export type NormalizedInbound = {
  manychat_page_id: string;
  subscriber_id: string;
  message_text: string;
  platform: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  profile_pic?: string;
  locale?: string;
  timezone?: string;
};

export function normalizeWebhookPayload(p: ManyChatWebhookPayload): NormalizedInbound | null {
  const platform = p.platform || "instagram";

  // Page ID: try multiple shapes
  const pageId =
    p.manychat_page_id ||
    p.page_id ||
    (p.contact?.page_id != null ? String(p.contact.page_id) : undefined);

  // Subscriber ID
  const subscriberId =
    p.subscriber_id || (p.contact?.id != null ? String(p.contact.id) : undefined);

  // Message text
  const messageText = p.message?.text || p.message_text || p.last_input_text;

  if (!pageId || !subscriberId || !messageText) return null;

  // Name fields
  const first_name = p.subscriber?.first_name || p.contact?.first_name;
  const last_name = p.subscriber?.last_name || p.contact?.last_name;
  const full_name =
    p.subscriber?.full_name ||
    p.contact?.name ||
    [first_name, last_name].filter(Boolean).join(" ") ||
    undefined;
  const profile_pic = p.subscriber?.profile_pic || p.contact?.profile_pic;
  const locale = p.subscriber?.locale || p.contact?.locale;
  const timezone = p.subscriber?.timezone || (p.contact?.timezone ? String(p.contact.timezone) : undefined);

  return {
    manychat_page_id: pageId,
    subscriber_id: subscriberId,
    message_text: messageText,
    platform,
    first_name,
    last_name,
    full_name,
    profile_pic,
    locale,
    timezone,
  };
}
