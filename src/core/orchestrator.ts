import { logger } from "../utils/logger.js";
import { toolRegistry } from "../tools/tool-registry.js";
import { memoryStore } from "../memory/memory-store.js";
import { memoryManager } from "../memory/memoryManager.js";
import { classifyMemoryIntent, shouldSaveSession } from "../memory/classifier.js";
import {
  detectRecallQuery,
  formatUserMemory,
  formatRules,
  formatProjectMemory,
  formatSessions,
} from "../memory/recall.js";
import { approvalManager } from "../approvals/approval-manager.js";
import { generateId } from "../utils/helpers.js";
import { eventBus } from "./event-bus.js";
import { taskQueue } from "./task-queue.js";
import type {
  AgentMessage,
  AgentResponse,
  AgentRoute,
  ModelRequest,
  ModelResponse,
} from "./types.js";

export type ModelHandler = (req: ModelRequest) => Promise<ModelResponse>;

export type DecisionType = "TOOL" | "MODEL" | "MEMORY";

export interface Decision {
  type: DecisionType;
  action: string;
  payload: Record<string, unknown>;
}

const STEP = (msg: string) => logger.info(`[STEP] ${msg}`);

export class Orchestrator {
  private _active = false;
  private modelHandler: ModelHandler | null = null;

  get active(): boolean {
    return this._active;
  }

  setModelHandler(handler: ModelHandler): void {
    this.modelHandler = handler;
    logger.info("Orchestrator: model handler registered");
  }

  async process(message: AgentMessage): Promise<void> {
    if (!this._active) {
      logger.warn(
        `Orchestrator: ignoring message ${message.id} — orchestrator is not active`,
      );
      return;
    }

    STEP(`received input: ${message.content.slice(0, 80)}`);
    STEP("sending to orchestrator");

    logger.info(
      `Orchestrator: received message [${message.id}] role=${message.role} source=${message.source}`,
    );

    taskQueue.enqueue(
      message.id,
      () => this.dispatch(message),
      `dispatch:${message.role}:${message.source}`,
    );
  }

  private decide(message: AgentMessage): Decision {
    if (message.toolCall) {
      return {
        type: "TOOL",
        action: message.toolCall.name,
        payload: message.toolCall.input as Record<string, unknown>,
      };
    }

    const raw   = message.content.trim();
    const lower = raw.toLowerCase();

    // 1. Recall queries → fast path, no AI call
    const recall = detectRecallQuery(raw);
    if (recall) {
      return { type: "MEMORY", action: "recall", payload: { target: recall.target, projectName: recall.projectName } };
    }

    // 2. Memory save (classifier)
    const classified = classifyMemoryIntent(raw);
    if (classified && classified.category !== "SKIP") {
      return { type: "MEMORY", action: "save", payload: { classification: classified } };
    }

    // 3. Legacy shorthand commands
    if (lower.startsWith("memory:") || lower.startsWith("recall:")) {
      const key = raw.replace(/^(memory:|recall:)/i, "").trim();
      return { type: "MEMORY", action: "lookup", payload: { key } };
    }

    if (lower.startsWith("run ")) {
      return { type: "TOOL", action: "run_terminal", payload: { command: raw.slice(4).trim() } };
    }
    if (lower.startsWith("read file ")) {
      return { type: "TOOL", action: "read_file", payload: { path: raw.slice(10).trim() } };
    }
    if (lower.startsWith("write file ")) {
      const rest     = raw.slice(11).trim();
      const spaceIdx = rest.indexOf(" ");
      return {
        type: "TOOL", action: "write_file",
        payload: {
          path:    spaceIdx > -1 ? rest.slice(0, spaceIdx) : rest,
          content: spaceIdx > -1 ? rest.slice(spaceIdx + 1) : "",
        },
      };
    }
    if (lower.startsWith("open ")) {
      return { type: "TOOL", action: "open_app", payload: { app: raw.slice(5).trim() } };
    }
    if (lower.startsWith("search ")) {
      return { type: "TOOL", action: "search_web", payload: { query: raw.slice(7).trim() } };
    }

    return { type: "MODEL", action: "generate", payload: { content: message.content } };
  }

  private async dispatch(message: AgentMessage): Promise<void> {
    const start = Date.now();
    let response: AgentResponse;

    try {
      const decision = this.decide(message);

      STEP(`decision: ${decision.type}  (action=${decision.action})`);

      logger.info(
        `Orchestrator: decision [${message.id}] type=${decision.type} action=${decision.action}`,
      );

      let route: AgentRoute;
      switch (decision.type) {
        case "TOOL":
          route = "tool";
          break;
        case "MEMORY":
          route = "memory";
          break;
        default:
          route = "model";
      }

      STEP(`executing task  route=${route}`);

      switch (route) {
        case "tool":
          response = await this.handleTool(message, decision, start);
          break;
        case "memory":
          response = await this.handleMemory(message, decision, start);
          break;
        default:
          response = await this.handleModel(message, start);
      }

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Orchestrator: dispatch error for [${message.id}] — ${error.message}`);

      response = {
        id: generateId("resp"),
        messageId: message.id,
        content: `Internal error: ${error.message}`,
        route: "passthrough",
        success: false,
        error: error.message,
        source: "orchestrator",
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };

      eventBus.emit("error", { source: "orchestrator.dispatch", error });
    }

    STEP(`completed  success=${response.success} route=${response.route} (${response.durationMs}ms)`);

    memoryStore.set(`response:${message.id}`, response, 5 * 60 * 1000);
    eventBus.emit("response", response);

    logger.info(
      `Orchestrator: responded [${response.id}] for msg=${message.id} ` +
        `success=${response.success} route=${response.route} (${response.durationMs}ms)`,
    );
  }

  private async handleTool(
    message: AgentMessage,
    decision: Decision,
    start: number,
  ): Promise<AgentResponse> {
    const toolName = message.toolCall?.name ?? decision.action;
    const toolInput = (message.toolCall?.input ?? decision.payload) as Record<string, unknown>;

    logger.info(
      `Orchestrator: tool call [${message.id}] tool=${toolName} input=${JSON.stringify(toolInput)}`,
    );

    eventBus.emit("toolCall", {
      messageId: message.id,
      toolName,
      input: toolInput,
      source: message.source,
    });

    const tool = toolRegistry.get(toolName);

    if (!tool) {
      const available = toolRegistry.list().map((t) => t.name);
      const msg = available.length > 0
        ? `Tool "${toolName}" not found. Available: ${available.join(", ")}`
        : `Tool "${toolName}" not found. No tools are registered yet.`;
      logger.warn(`Orchestrator: ${msg}`);
      return this.toolErrorResponse(message, toolName, msg, start);
    }

    const outcome = await approvalManager.check(
      toolName,
      tool.risk_level,
      message.source,
      { messageId: message.id, input: toolInput },
    );

    if (!outcome.allowed) {
      logger.warn(
        `Orchestrator: tool "${toolName}" blocked by approval — ${outcome.reason}`,
      );
      return {
        id: generateId("resp"),
        messageId: message.id,
        content: `Execution blocked: ${outcome.reason}`,
        route: "tool",
        success: false,
        error: outcome.reason,
        toolName,
        source: "orchestrator",
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const result = await toolRegistry.invoke(toolName, toolInput);

    return {
      id: generateId("resp"),
      messageId: message.id,
      content: result.success
        ? (result.output || JSON.stringify(result.data ?? null))
        : (result.error ?? "Tool returned no data"),
      route: "tool",
      success: result.success,
      error: result.error,
      toolName,
      toolData: result.data,
      source: "orchestrator",
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private toolErrorResponse(
    message: AgentMessage,
    toolName: string,
    msg: string,
    start: number,
  ): AgentResponse {
    return {
      id: generateId("resp"),
      messageId: message.id,
      content: msg,
      route: "tool",
      success: false,
      error: msg,
      toolName,
      source: "orchestrator",
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private async handleMemory(
    message: AgentMessage,
    decision: Decision,
    start: number,
  ): Promise<AgentResponse> {
    // ── RECALL: answer user's memory questions instantly ─────────────────
    if (decision.action === "recall") {
      const target      = decision.payload["target"] as string;
      const projectName = decision.payload["projectName"] as string | undefined;
      logger.info(`Orchestrator: memory recall [${message.id}] target=${target}`);

      let content = "";
      switch (target) {
        case "user":
          content = formatUserMemory(memoryManager.getUserMemory());
          break;
        case "rules":
          content = formatRules(memoryManager.getRules());
          break;
        case "sessions":
          content = formatSessions(memoryManager.getRecentSessionEntries(10));
          break;
        case "project":
          {
            const projName = projectName ?? memoryManager.activeProject ?? "default";
            content = formatProjectMemory(memoryManager.getProjectMemory(projName));
          }
          break;
        default:
          content = "لا أعرف ما تبحث عنه بالتحديد.";
      }

      return this.makeMemoryResponse(message, content, start);
    }

    // ── SAVE: classify and persist ────────────────────────────────────────
    if (decision.action === "save") {
      const cl = decision.payload["classification"] as import("../memory/classifier.js").Classification;
      logger.info(`Orchestrator: memory save [${message.id}] category=${cl.category}  subtype=${cl.subtype}`);

      const reply = memoryManager.saveClassified(cl);
      return this.makeMemoryResponse(message, reply, start);
    }

    // ── LOOKUP: legacy in-process store lookup ────────────────────────────
    const key   = (decision.payload["key"] as string | undefined) ?? "";
    logger.info(`Orchestrator: memory lookup [${message.id}] key="${key}"`);
    const value = memoryStore.get(key);

    const content =
      value === undefined
        ? `No memory found for key: "${key}"`
        : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);

    return {
      id: generateId("resp"),
      messageId: message.id,
      content,
      route: "memory",
      success: true,
      toolData: value,
      source: "orchestrator",
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private makeMemoryResponse(
    message: AgentMessage,
    content: string,
    start: number,
  ): AgentResponse {
    return {
      id: generateId("resp"),
      messageId: message.id,
      content,
      route: "memory",
      success: true,
      source: "orchestrator",
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private async handleModel(
    message: AgentMessage,
    start: number,
  ): Promise<AgentResponse> {
    const history       = memoryStore.get<AgentMessage[]>(`history:${message.source}`) ?? [];
    const memoryContext = memoryManager.getMemoryContext(8);

    const req: ModelRequest = {
      messageId: message.id,
      content:   message.content,
      history,
      metadata:  message.metadata,
      memoryContext,
    };

    logger.info(
      `Orchestrator: model request [${message.id}] history=${history.length} entries  memory=loaded`,
    );

    if (!this.modelHandler) {
      logger.warn(
        `Orchestrator: decision=MODEL but no model handler is registered — returning stub`,
      );
      return {
        id: generateId("resp"),
        messageId: message.id,
        content: `[MODEL] No model handler configured. Input was: "${message.content}"`,
        route: "model",
        success: false,
        error: "No model handler registered",
        source: "orchestrator",
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const modelResp = await this.modelHandler(req);

    if (modelResp.toolCall) {
      STEP(`AI decided TOOL  tool=${modelResp.toolCall.name}  intent=${String(modelResp.metadata?.["intent"] ?? "TOOL_REQUEST")}`);
      logger.info(
        `Orchestrator: AI-driven tool call [${message.id}] tool=${modelResp.toolCall.name} input=${JSON.stringify(modelResp.toolCall.input)}`,
      );

      const toolDecision: Decision = {
        type: "TOOL",
        action: modelResp.toolCall.name,
        payload: modelResp.toolCall.input,
      };

      const toolResult = await this.handleTool(message, toolDecision, start);

      this.appendHistory(message, toolResult.content, history);

      const toolIntent  = String(modelResp.metadata?.["intent"] ?? "TOOL_REQUEST");
      const toolAction  = `tool:${modelResp.toolCall.name}`;
      if (shouldSaveSession(toolIntent, toolAction)) {
        memoryManager.appendSessionEntry({
          user_input:        message.content.slice(0, 120),
          classified_intent: toolIntent,
          action_taken:      toolAction,
          result_summary:    toolResult.success
            ? toolResult.content.slice(0, 100)
            : `error: ${toolResult.error ?? "unknown"}`,
        });
      }

      return {
        ...toolResult,
        route: "model",
      };
    }

    const intent = String(modelResp.metadata?.["intent"] ?? "CHAT");
    STEP(`AI decided RESPONSE  intent=${intent}`);

    this.appendHistory(message, modelResp.content, history);

    if (shouldSaveSession(intent, "response")) {
      memoryManager.appendSessionEntry({
        user_input:        message.content.slice(0, 120),
        classified_intent: intent,
        action_taken:      "response",
        result_summary:    modelResp.content.slice(0, 100),
      });
    }

    return {
      id: generateId("resp"),
      messageId: message.id,
      content: modelResp.content,
      route: "model",
      success: true,
      source: "orchestrator",
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  private appendHistory(
    userMsg: AgentMessage,
    assistantContent: string,
    previousHistory: AgentMessage[],
  ): void {
    const assistantMsg: AgentMessage = {
      id:        generateId("msg"),
      role:      "assistant",
      content:   assistantContent,
      source:    "kassar",
      timestamp: Date.now(),
    };
    const updated = [...previousHistory.slice(-48), userMsg, assistantMsg];
    memoryStore.set(`history:${userMsg.source}`, updated, 30 * 60 * 1000);
  }

  start(): void {
    this._active = true;
    logger.info("Orchestrator started");
  }

  async stop(): Promise<void> {
    this._active = false;
    logger.info(
      `Orchestrator stopping — draining ${taskQueue.pendingCount()} pending task(s)...`,
    );
    await taskQueue.drain();
    taskQueue.resume();
    logger.info("Orchestrator stopped");
  }

  isRunning(): boolean {
    return this._active;
  }

  queueStats() {
    return taskQueue.stats();
  }
}

export const orchestrator = new Orchestrator();
