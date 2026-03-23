import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";
import type { AgentMessage, AgentResponse } from "./types.js";

export interface ToolCallEvent {
  messageId: string;
  toolName: string;
  input: Record<string, unknown>;
  source: string;
}

export interface ErrorEvent {
  source: string;
  error: Error;
  context?: unknown;
}

export interface TaskQueuedEvent {
  taskId: string;
  messageId: string;
}

export interface TaskStartedEvent {
  taskId: string;
  messageId: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  messageId: string;
  durationMs: number;
}

export interface TaskFailedEvent {
  taskId: string;
  messageId: string;
  error: string;
}

export interface EventMap {
  message: AgentMessage;
  toolCall: ToolCallEvent;
  response: AgentResponse;
  error: ErrorEvent;
  taskQueued: TaskQueuedEvent;
  taskStarted: TaskStartedEvent;
  taskCompleted: TaskCompletedEvent;
  taskFailed: TaskFailedEvent;
}

type Handler<K extends keyof EventMap> = (data: EventMap[K]) => void;

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
  }

  on<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  once<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  onMessage(handler: Handler<"message">): void {
    this.on("message", handler);
  }

  onToolCall(handler: Handler<"toolCall">): void {
    this.on("toolCall", handler);
  }

  onResponse(handler: Handler<"response">): void {
    this.on("response", handler);
  }

  onError(handler: Handler<"error">): void {
    this.on("error", handler);
  }

  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    logger.debug(`EventBus: listeners removed${event ? ` for "${event}"` : ""}`);
  }

  listenerCount(event: keyof EventMap): number {
    return this.emitter.listenerCount(event);
  }
}

export const eventBus = new EventBus();
