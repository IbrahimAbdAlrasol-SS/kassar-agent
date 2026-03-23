import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const CONFIG_PATH = resolve(__dirname, "config.json");

export interface AgentConfig {
  agent: {
    name: string;
    version: string;
    maxRetries: number;
    retryDelayMs: number;
  };
  logging: {
    level: string;
    file: string;
    maxSize: string;
    maxFiles: number;
  };
  api: {
    baseUrl: string;
    timeoutMs: number;
  };
  workspace: {
    dir: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
}

const DEFAULT_CONFIG: AgentConfig = {
  agent: {
    name: "kassar-agent",
    version: "1.0.0",
    maxRetries: 3,
    retryDelayMs: 1000,
  },
  logging: {
    level: "info",
    file: "logs/app.log",
    maxSize: "10m",
    maxFiles: 5,
  },
  api: {
    baseUrl: "http://localhost:3000",
    timeoutMs: 30000,
  },
  workspace: {
    dir: "./workspace",
  },
  telegram: {
    botToken: "",
    chatId: "",
  },
};

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

function loadConfigFile(): Partial<AgentConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as Partial<AgentConfig>;
}

function applyEnvOverrides(cfg: AgentConfig): AgentConfig {
  if (process.env["LOG_LEVEL"]) cfg.logging.level = process.env["LOG_LEVEL"];
  if (process.env["AGENT_NAME"]) cfg.agent.name = process.env["AGENT_NAME"];
  if (process.env["API_BASE_URL"]) cfg.api.baseUrl = process.env["API_BASE_URL"];
  if (process.env["WORKSPACE_DIR"]) cfg.workspace.dir = process.env["WORKSPACE_DIR"];
  if (process.env["BOT_TOKEN"]) cfg.telegram.botToken = process.env["BOT_TOKEN"];
  if (process.env["TELEGRAM_CHAT_ID"]) cfg.telegram.chatId = process.env["TELEGRAM_CHAT_ID"];
  return cfg;
}

export function loadConfig(): AgentConfig {
  const fileConfig = loadConfigFile();
  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    fileConfig as Record<string, unknown>,
  ) as unknown as AgentConfig;
  return applyEnvOverrides(merged);
}

export function writeConfig(cfg: AgentConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

export function getNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  const keys = dotPath.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const keys = dotPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

export const config = loadConfig();
