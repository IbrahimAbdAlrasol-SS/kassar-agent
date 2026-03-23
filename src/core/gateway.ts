import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { memoryStore } from "../memory/memory-store.js";
import { toolRegistry } from "../tools/tool-registry.js";
import { loadTools } from "../tools/load-tools.js";
import { generateId } from "../utils/helpers.js";
import { eventBus } from "./event-bus.js";
import { orchestrator } from "./orchestrator.js";
import { taskQueue } from "./task-queue.js";
import { replitModelHandler } from "../services/model/index.js";
import type { AgentMessage } from "./types.js";

export class Gateway {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      logger.warn("Gateway.start() called more than once — ignoring");
      return;
    }
    this.started = true;

    logger.info(`${config.agent.name} v${config.agent.version} starting`);
    logger.info(`Environment : ${process.env["NODE_ENV"] || "development"}`);
    logger.info(`Log level   : ${config.logging.level}`);
    logger.info(`Workspace   : ${config.workspace.dir}`);
    logger.info(
      `Tools       : ${toolRegistry.count()} registered [${toolRegistry.list().map((t) => t.name).join(", ") || "none"}]`,
    );

    loadTools();

    orchestrator.start();
    orchestrator.setModelHandler(replitModelHandler);

    this.attachEventHandlers();

    this.cleanupInterval = setInterval(() => {
      const removed = memoryStore.cleanup();
      if (removed > 0) {
        logger.debug(`Memory cleanup: evicted ${removed} expired entries`);
      }
    }, 60_000);

    this.statsInterval = setInterval(() => {
      const qs = taskQueue.stats();
      if (!taskQueue.isIdle()) {
        logger.debug(
          `Queue stats: pending=${qs.pending} active=${qs.active} total=${qs.total}`,
        );
      }
    }, 30_000);

    this.registerShutdownHandlers();

    logger.info(`${config.agent.name} is ready`);
  }

  private attachEventHandlers(): void {
    eventBus.onMessage((msg) => {
      logger.info(
        `[event:message] id=${msg.id} role=${msg.role} source=${msg.source} ` +
          `content="${msg.content.slice(0, 80)}${msg.content.length > 80 ? "…" : ""}"`,
      );
    });

    eventBus.onToolCall((ev) => {
      logger.info(
        `[event:toolCall] msgId=${ev.messageId} tool=${ev.toolName} source=${ev.source} ` +
          `input=${JSON.stringify(ev.input)}`,
      );
    });

    eventBus.onResponse((resp) => {
      logger.info(
        `[event:response] id=${resp.id} msgId=${resp.messageId} route=${resp.route} ` +
          `success=${resp.success} duration=${resp.durationMs}ms`,
      );
      if (!resp.success && resp.error) {
        logger.warn(`[event:response] error=${resp.error}`);
      }
    });

    eventBus.onError((ev) => {
      logger.error(
        `[event:error] source=${ev.source} error=${ev.error.message}`,
        { stack: ev.error.stack, context: ev.context },
      );
    });

    eventBus.on("taskQueued", (ev) => {
      logger.debug(`[event:taskQueued] taskId=${ev.taskId} msgId=${ev.messageId}`);
    });

    eventBus.on("taskStarted", (ev) => {
      logger.debug(`[event:taskStarted] taskId=${ev.taskId} msgId=${ev.messageId}`);
    });

    eventBus.on("taskCompleted", (ev) => {
      logger.debug(
        `[event:taskCompleted] taskId=${ev.taskId} msgId=${ev.messageId} duration=${ev.durationMs}ms`,
      );
    });

    eventBus.on("taskFailed", (ev) => {
      logger.warn(
        `[event:taskFailed] taskId=${ev.taskId} msgId=${ev.messageId} error=${ev.error}`,
      );
    });

    logger.debug("Gateway: all event handlers attached");
  }

  async submit(
    content: string,
    options: {
      role?: AgentMessage["role"];
      source?: string;
      toolCall?: AgentMessage["toolCall"];
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<string> {
    if (!this.started) {
      throw new Error("Gateway is not running — call start() first");
    }

    const message: AgentMessage = {
      id: generateId("msg"),
      role: options.role ?? "user",
      content,
      source: options.source ?? "gateway",
      toolCall: options.toolCall,
      timestamp: Date.now(),
      metadata: options.metadata,
    };

    eventBus.emit("message", message);

    safeAsync(
      () => orchestrator.process(message),
      "gateway.submit → orchestrator.process",
    );

    return message.id;
  }

  async stop(): Promise<void> {
    logger.info(`${config.agent.name} shutting down`);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    await orchestrator.stop();

    eventBus.removeAllListeners();
    memoryStore.clear();

    this.started = false;
    logger.info(`${config.agent.name} stopped`);
  }

  isReady(): boolean {
    return this.started && orchestrator.isRunning();
  }

  private registerShutdownHandlers(): void {
    let shuttingDown = false;

    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal} — beginning graceful shutdown`);
      try {
        await this.stop();
      } catch (err) {
        logger.error("Error during shutdown", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      process.exit(0);
    };

    process.on("SIGINT", () => { void shutdown("SIGINT"); });
    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

    process.on("uncaughtException", (err) => {
      logger.error("Uncaught exception", {
        error: err.message,
        stack: err.stack,
      });
      eventBus.emit("error", { source: "process.uncaughtException", error: err });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      const err =
        reason instanceof Error ? reason : new Error(String(reason));
      logger.error("Unhandled rejection", {
        error: err.message,
        stack: err.stack,
      });
      eventBus.emit("error", { source: "process.unhandledRejection", error: err });
      process.exit(1);
    });
  }
}

function safeAsync(fn: () => Promise<void>, label: string): void {
  fn().catch((err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`Async error in ${label}: ${error.message}`, {
      stack: error.stack,
    });
    eventBus.emit("error", { source: label, error });
  });
}

export async function boot(): Promise<Gateway> {
  const gw = new Gateway();
  await gw.start();
  return gw;
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("gateway.ts") ||
    process.argv[1].endsWith("gateway.js"));

if (isDirectRun) {
  boot()
    .then(async (gw) => {
      const { startTelegramIfConfigured } = await import("../adapters/telegram/index.js");
      await startTelegramIfConfigured(gw);
    })
    .catch((err) => {
      logger.error("Failed to start gateway", { error: String(err) });
      process.exit(1);
    });
}
