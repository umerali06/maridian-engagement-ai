#!/bin/bash
# Polls Telegram getUpdates and prints the chat_id of any message the bot received.
# Usage: bash scripts/get-telegram-chatid.sh

source .env.local 2>/dev/null

if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  echo "TELEGRAM_BOT_TOKEN not set"
  exit 1
fi

echo "Esperando mensaje al bot... (envíale '/start' al bot ahora desde Telegram)"
echo "Bot: @Trademeridian_bot"
echo ""

for i in {1..30}; do
  RESULT=$(curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates")
  CHAT_ID=$(echo "$RESULT" | grep -o '"chat":{[^}]*"id":[-0-9]*' | grep -o '"id":[-0-9]*' | head -1 | cut -d: -f2)
  CHAT_TYPE=$(echo "$RESULT" | grep -o '"chat":{[^}]*"type":"[^"]*"' | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -n "$CHAT_ID" ]]; then
    echo "✓ Chat detectado: $CHAT_ID (tipo: $CHAT_TYPE)"
    echo ""
    echo "Pega esta línea en .env.local (reemplaza la vacía):"
    echo "TELEGRAM_OPS_CHAT_ID=$CHAT_ID"
    exit 0
  fi
  sleep 2
done

echo "Timeout. No llegó ningún mensaje en 60s. Reintenta el script después de mandarle /start al bot."
