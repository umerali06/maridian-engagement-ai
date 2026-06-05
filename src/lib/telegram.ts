/**
 * Telegram notifications for handoffs and learning-loop digests.
 * Silently no-op if TELEGRAM_BOT_TOKEN is unset.
 */
export async function sendTelegram(
  text: string,
  opts: { chatId?: string; parseMode?: "Markdown" | "HTML" } = {},
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId || process.env.TELEGRAM_OPS_CHAT_ID;
  if (!token || !chatId) {
    console.log("[telegram] skipped (no token/chat configured):", text.slice(0, 80));
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode || "Markdown",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error("[telegram] send failed", res.status, await res.text());
  }
}
