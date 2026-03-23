export { TelegramAdapter } from "./telegram.js";

import { TelegramAdapter } from "./telegram.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import type { Gateway } from "../../core/gateway.js";

export async function startTelegramIfConfigured(gateway: Gateway): Promise<TelegramAdapter | null> {
  const token = config.telegram.botToken;

  if (!token) {
    logger.info("[TELEGRAM] BOT_TOKEN not set — adapter disabled");
    return null;
  }

  const adapter = new TelegramAdapter(token, gateway);
  adapter.start();

  const chatId = config.telegram.chatId;
  if (chatId) {
    await adapter.notify(chatId, "✅ kassar-agent is online and ready.\n\nSend me any text command to get started.");
  }

  return adapter;
}
