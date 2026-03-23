import OpenAI from "openai";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../../utils/logger.js";
import type { ModelRequest, ModelResponse, AgentMessage } from "../../core/types.js";
import { buildSmartContext } from "../../memory/recall.js";
import type { MemoryContext } from "../../memory/types.js";
import { loadConfig } from "../../config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../../../prompts");

const VALID_TOOLS = new Set([
  "run_terminal",
  "read_file",
  "write_file",
  "open_app",
  "search_web",
]);

export type IntentType =
  | "CHAT"
  | "SELF_DESCRIPTION"
  | "TOOL_REQUEST"
  | "SENSITIVE_REQUEST"
  | "CLARIFICATION";

export interface ModelDecision {
  intent: IntentType;
  type: "TOOL" | "RESPONSE";
  tool: string | null;
  input: Record<string, unknown> | null;
  response: string | null;
}

const MODEL_LOG  = (msg: string) => logger.info(`[MODEL] ${msg}`);
const MODEL_WARN = (msg: string) => logger.warn(`[MODEL] ${msg}`);

function loadPrompt(filename: string): string {
  const fp = path.join(PROMPTS_DIR, filename);
  if (!existsSync(fp)) return "";
  return readFileSync(fp, "utf-8").trim();
}

function buildSystemPrompt(): string {
  const soul   = loadPrompt("SOUL.md");
  const tools  = loadPrompt("TOOLS.md");
  const agents = loadPrompt("AGENTS.md");

  const preamble = [soul, tools, agents].filter(Boolean).join("\n\n---\n\n");

  const contract = `\
# OUTPUT CONTRACT

Respond with exactly ONE JSON object. Nothing before it. Nothing after it.
No markdown. No code fences. No explanation. Start with { end with }.

Schema:
{"intent":"<INTENT>","type":"TOOL","tool":"<tool_name>","input":{...},"response":null}
{"intent":"<INTENT>","type":"RESPONSE","tool":null,"input":null,"response":"<text>"}

intent must be one of: CHAT, SELF_DESCRIPTION, TOOL_REQUEST, SENSITIVE_REQUEST, CLARIFICATION
type  must be one of: TOOL, RESPONSE

Constraints:
- SENSITIVE_REQUEST → always RESPONSE (ask for confirmation, never execute)
- CLARIFICATION     → always RESPONSE (ask ONE specific question)
- CHAT              → always RESPONSE (brief, natural, in character as Kassar)
- SELF_DESCRIPTION  → always RESPONSE (describe Kassar, never say "I am an AI")
- TOOL_REQUEST      → prefer TOOL if target is clear, else CLARIFICATION

Anti-patterns (NEVER do these):
- Do not say "I am an AI", "As an AI", or "I'm here to help"
- Do not repeat your previous response
- Do not produce long explanations when a short answer suffices
- Do not use a tool when intent is CHAT or SELF_DESCRIPTION`;

  return `${preamble}\n\n---\n\n${contract}`;
}

function buildMessages(
  req: ModelRequest,
  systemPrompt: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  let fullSystem = systemPrompt;

  if (req.memoryContext) {
    const memSection = buildSmartContext(req.content, req.memoryContext);
    fullSystem = `${systemPrompt}\n\n---\n\n${memSection}`;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: fullSystem },
  ];

  const history = (req.history ?? []).slice(-12) as AgentMessage[];
  for (const h of history) {
    messages.push({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    });
  }

  messages.push({ role: "user", content: req.content });
  return messages;
}

function extractJson(raw: string): string {
  const stripped = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

function parseDecision(raw: string): ModelDecision {
  const cleaned = extractJson(raw);
  const parsed  = JSON.parse(cleaned) as Partial<ModelDecision>;

  const VALID_INTENTS: IntentType[] = [
    "CHAT", "SELF_DESCRIPTION", "TOOL_REQUEST", "SENSITIVE_REQUEST", "CLARIFICATION",
  ];

  const intent: IntentType = VALID_INTENTS.includes(parsed.intent as IntentType)
    ? (parsed.intent as IntentType)
    : "CHAT";

  if (parsed.type !== "TOOL" && parsed.type !== "RESPONSE") {
    throw new Error(`Invalid decision type: "${String(parsed.type)}"`);
  }

  if (parsed.type === "TOOL") {
    if (!parsed.tool || !VALID_TOOLS.has(parsed.tool)) {
      throw new Error(`Unknown tool: "${String(parsed.tool)}"`);
    }
    if (!parsed.input || typeof parsed.input !== "object") {
      throw new Error("TOOL decision missing input");
    }
  }

  if (parsed.type === "RESPONSE" && typeof parsed.response !== "string") {
    throw new Error("RESPONSE decision missing response string");
  }

  return {
    intent,
    type:     parsed.type,
    tool:     parsed.tool     ?? null,
    input:    parsed.input    ?? null,
    response: parsed.response ?? null,
  };
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;

  // ── Priority 1: Replit AI Integrations (running inside Replit) ──
  const replitBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  if (replitBaseURL) {
    const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ?? "replit";
    MODEL_LOG(`provider=replit-ai  baseURL=${replitBaseURL}`);
    client = new OpenAI({ apiKey, baseURL: replitBaseURL });
    return client;
  }

  // ── Priority 2: config.json [model] section ──
  const cfg      = loadConfig();
  const modelCfg = cfg.model;

  const apiKey = modelCfg?.apiKey || process.env["OPENAI_API_KEY"] || "";
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured.\n" +
      "Run: kassar config set model.apiKey sk-...\n" +
      "Or set the OPENAI_API_KEY environment variable."
    );
  }

  const baseURL = modelCfg?.baseURL || "https://api.openai.com/v1";
  MODEL_LOG(`provider=openai  baseURL=${baseURL}  model=${modelCfg?.model ?? "gpt-4o-mini"}`);
  client = new OpenAI({ apiKey, baseURL });
  return client;
}

export async function callModel(req: ModelRequest): Promise<ModelDecision> {
  const systemPrompt = buildSystemPrompt();
  const messages     = buildMessages(req, systemPrompt);

  MODEL_LOG(
    `request  id=${req.messageId}  history=${(req.history ?? []).length}` +
    `  content="${req.content.slice(0, 80)}"`,
  );

  const cfg      = loadConfig();
  const modelCfg = cfg.model;
  const modelName  = modelCfg?.model || "gpt-4o-mini";
  const maxTokens  = modelCfg?.maxCompletionTokens || 1280;

  const completion = await getClient().chat.completions.create({
    model: modelName,
    messages,
    max_completion_tokens: maxTokens,
  });

  const raw     = (completion.choices[0]?.message?.content ?? "").trim();
  const usage   = completion.usage as Record<string, unknown> | undefined;
  const rTokens = (
    (usage?.["completion_tokens_details"] as Record<string, unknown> | undefined)
      ?.["reasoning_tokens"]
  );

  MODEL_LOG(
    `response  id=${req.messageId}  tokens=${usage?.["total_tokens"] ?? "?"}` +
    (rTokens ? `  reasoning=${String(rTokens)}` : "") +
    `  raw="${raw.slice(0, 140)}"`,
  );

  if (!raw) {
    MODEL_WARN(`Empty output — reasoning exhausted tokens. Returning CLARIFICATION fallback.`);
    return {
      intent:   "CLARIFICATION",
      type:     "RESPONSE",
      tool:     null,
      input:    null,
      response: "لم أتمكن من معالجة طلبك. هل يمكنك إعادة صياغته؟",
    };
  }

  try {
    const decision = parseDecision(raw);
    logger.info(
      `[DECISION] intent=${decision.intent}  type=${decision.type}  tool=${decision.tool ?? "none"}`,
    );
    return decision;
  } catch (parseErr) {
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    MODEL_WARN(`JSON parse failed: ${errMsg}  raw="${raw.slice(0, 200)}"`);
    throw parseErr;
  }
}

export async function replitModelHandler(req: ModelRequest): Promise<ModelResponse> {
  try {
    const decision = await callModel(req);

    if (decision.type === "TOOL" && decision.tool && decision.input) {
      return {
        content: `[tool:${decision.tool}]`,
        toolCall: {
          name:  decision.tool,
          input: decision.input,
        },
        metadata: { intent: decision.intent },
      };
    }

    const text = decision.response?.trim();
    if (!text) {
      MODEL_WARN(`RESPONSE intent=${decision.intent} but response is empty`);
    }

    return {
      content:  text || "عذراً، لم أتمكن من توليد رد. حاول مجدداً.",
      metadata: { intent: decision.intent },
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    MODEL_WARN(`Unhandled model error — ${msg}`);
    return {
      content:  "حدث خطأ أثناء المعالجة. أرسل رسالتك مجدداً.",
      metadata: { intent: "CLARIFICATION" },
    };
  }
}
