import TelegramBot from "node-telegram-bot-api";
import { createWriteStream, mkdirSync } from "fs";
import path from "path";
import https from "https";
import http from "http";
import { logger } from "../../utils/logger.js";
import { eventBus } from "../../core/event-bus.js";
import { formatResponse } from "../../core/responseFormatter.js";
import type { Gateway } from "../../core/gateway.js";
import type { AgentResponse } from "../../core/types.js";

const TG = (msg: string) => logger.info(`[TELEGRAM] ${msg}`);
const TG_WARN = (msg: string) => logger.warn(`[TELEGRAM] ${msg}`);
const TG_ERR = (msg: string, err?: unknown) =>
  logger.error(`[TELEGRAM] ${msg}`, { error: err instanceof Error ? err.message : String(err ?? "") });

const TEMP_DIR = path.resolve("temp");
mkdirSync(TEMP_DIR, { recursive: true });

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = createWriteStream(dest);
    client.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
      file.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadTelegramFile(
  bot: TelegramBot,
  fileId: string,
  extension: string,
): Promise<string> {
  const fileInfo = await bot.getFile(fileId);
  const filePath = fileInfo.file_path;
  if (!filePath) throw new Error(`Telegram returned no file_path for ${fileId}`);

  const token = (bot as unknown as { token: string }).token;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const dest = path.join(TEMP_DIR, `${fileId}.${extension}`);
  await downloadFile(url, dest);
  return dest;
}

async function handleVoiceStub(localPath: string, chatId: number): Promise<string> {
  TG(`[VOICE] received file  path=${localPath}  chatId=${chatId}`);
  return "[Voice received — transcription service not yet configured]";
}

async function handleImageStub(localPath: string, chatId: number): Promise<string> {
  TG(`[IMAGE] received file  path=${localPath}  chatId=${chatId}`);
  return "[Image received — vision handler not yet configured]";
}

export class TelegramAdapter {
  private bot: TelegramBot;
  private gateway: Gateway;
  private pending: Map<string, number> = new Map();
  private running = false;

  constructor(token: string, gateway: Gateway) {
    this.bot = new TelegramBot(token, { polling: false });
    this.gateway = gateway;
  }

  start(): void {
    if (this.running) {
      TG_WARN("Already running — ignoring duplicate start()");
      return;
    }
    this.running = true;

    this.bot.startPolling();

    eventBus.onResponse((resp: AgentResponse) => {
      const chatId = this.pending.get(resp.messageId);
      if (chatId === undefined) return;
      this.pending.delete(resp.messageId);
      this.sendResponse(chatId, resp).catch((err) =>
        TG_ERR(`Failed to send response to chatId=${chatId}`, err),
      );
    });

    this.bot.on("message", (msg) => {
      this.onMessage(msg).catch((err) =>
        TG_ERR(`Error handling message from chatId=${msg.chat.id}`, err),
      );
    });

    this.bot.on("polling_error", (err) => {
      TG_ERR("Polling error", err);
    });

    this.bot.on("error", (err) => {
      TG_ERR("Bot error", err);
    });

    TG("Adapter started — polling Telegram");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.bot.stopPolling();
    TG("Adapter stopped");
  }

  async notify(chatId: string | number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(Number(chatId), text);
      TG(`notification sent  chatId=${chatId}`);
    } catch (err) {
      TG_ERR(`Failed to send notification  chatId=${chatId}`, err);
    }
  }

  private async onMessage(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const from = msg.from?.username ?? msg.from?.first_name ?? String(chatId);
    const source = `telegram:${chatId}`;

    if (msg.text) {
      TG(`message received  chatId=${chatId}  from=${from}  text="${msg.text.slice(0, 60)}"`);
      const msgId = await this.gateway.submit(msg.text, { source, role: "user" });
      this.pending.set(msgId, chatId);
      return;
    }

    if (msg.voice) {
      try {
        const dest = await downloadTelegramFile(this.bot, msg.voice.file_id, "ogg");
        const reply = await handleVoiceStub(dest, chatId);
        await this.bot.sendMessage(chatId, reply);
        TG(`response sent  chatId=${chatId}  type=voice`);
      } catch (err) {
        TG_ERR(`Voice handling failed  chatId=${chatId}`, err);
        await this.safeSend(chatId, "Sorry, I could not process your voice message.");
      }
      return;
    }

    if (msg.photo && msg.photo.length > 0) {
      try {
        const largest = msg.photo[msg.photo.length - 1]!;
        const dest = await downloadTelegramFile(this.bot, largest.file_id, "jpg");
        const reply = await handleImageStub(dest, chatId);
        await this.bot.sendMessage(chatId, reply);
        TG(`response sent  chatId=${chatId}  type=image`);
      } catch (err) {
        TG_ERR(`Image handling failed  chatId=${chatId}`, err);
        await this.safeSend(chatId, "Sorry, I could not process your image.");
      }
      return;
    }

    TG_WARN(`Unsupported message type  chatId=${chatId}  keys=${Object.keys(msg).join(",")}`);
  }

  private async sendResponse(chatId: number, resp: AgentResponse): Promise<void> {
    const { text, parseMode, formatType } = formatResponse(resp);

    try {
      const opts: TelegramBot.SendMessageOptions = parseMode
        ? { parse_mode: parseMode }
        : {};
      await this.bot.sendMessage(chatId, text, opts);
      TG(
        `response sent  chatId=${chatId}  route=${resp.route}  ` +
        `type=${formatType}  success=${resp.success}  parseMode=${parseMode ?? "none"}`,
      );
    } catch (markdownErr) {
      if (parseMode) {
        TG_WARN(
          `MarkdownV2 parse failed — falling back to plain text  chatId=${chatId}  ` +
          `error=${markdownErr instanceof Error ? markdownErr.message : String(markdownErr)}`,
        );
        const plain = text
          .replace(/\\/g, "")
          .replace(/[*_`]/g, "");
        try {
          await this.bot.sendMessage(chatId, plain);
          TG(`response sent  chatId=${chatId}  type=${formatType}  parseMode=plain-fallback`);
        } catch (plainErr) {
          TG_ERR(`Failed to send plain fallback  chatId=${chatId}`, plainErr);
        }
      } else {
        TG_ERR(`sendMessage failed  chatId=${chatId}`, markdownErr);
      }
    }
  }

  private async safeSend(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (err) {
      TG_ERR(`safeSend failed  chatId=${chatId}`, err);
    }
  }
}
