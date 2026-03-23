import { logger } from "../utils/logger.js";
import { generateId } from "../utils/helpers.js";
import { eventBus } from "./event-bus.js";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface QueuedTask {
  id: string;
  messageId: string;
  label: string;
  status: TaskStatus;
  addedAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

interface TaskEntry {
  meta: QueuedTask;
  fn: () => Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class TaskQueue {
  private queue: TaskEntry[] = [];
  private activeTasks: Map<string, TaskEntry> = new Map();
  private allTasks: Map<string, QueuedTask> = new Map();
  private concurrency: number;
  private _accepting = true;

  constructor(concurrency = 1) {
    this.concurrency = Math.max(1, concurrency);
  }

  enqueue(
    messageId: string,
    fn: () => Promise<void>,
    label = "task",
  ): QueuedTask {
    if (!this._accepting) {
      throw new Error("TaskQueue is draining — cannot enqueue new tasks");
    }

    const meta: QueuedTask = {
      id: generateId("task"),
      messageId,
      label,
      status: "pending",
      addedAt: Date.now(),
    };

    let resolveTask!: () => void;
    let rejectTask!: (err: Error) => void;

    const entry: TaskEntry = {
      meta,
      fn,
      resolve: () => resolveTask(),
      reject: (err) => rejectTask(err),
    };

    new Promise<void>((res, rej) => {
      resolveTask = res;
      rejectTask = rej;
    });

    this.queue.push(entry);
    this.allTasks.set(meta.id, meta);

    logger.debug(`Queue: task enqueued [${meta.id}] "${label}" (msg=${messageId})`);
    eventBus.emit("taskQueued", { taskId: meta.id, messageId });

    this.tick();
    return meta;
  }

  private tick(): void {
    while (
      this.queue.length > 0 &&
      this.activeTasks.size < this.concurrency
    ) {
      const entry = this.queue.shift()!;
      this.run(entry);
    }
  }

  private async run(entry: TaskEntry): Promise<void> {
    const { meta, fn } = entry;
    meta.status = "running";
    meta.startedAt = Date.now();
    this.activeTasks.set(meta.id, entry);

    logger.debug(`Queue: task started [${meta.id}] "${meta.label}"`);
    eventBus.emit("taskStarted", { taskId: meta.id, messageId: meta.messageId });

    try {
      await fn();
      meta.status = "completed";
      meta.completedAt = Date.now();
      meta.durationMs = meta.completedAt - (meta.startedAt ?? meta.completedAt);

      logger.debug(
        `Queue: task completed [${meta.id}] "${meta.label}" (${meta.durationMs}ms)`,
      );
      eventBus.emit("taskCompleted", {
        taskId: meta.id,
        messageId: meta.messageId,
        durationMs: meta.durationMs,
      });

      entry.resolve();
    } catch (err) {
      meta.status = "failed";
      meta.completedAt = Date.now();
      meta.durationMs = meta.completedAt - (meta.startedAt ?? meta.completedAt);
      meta.error = err instanceof Error ? err.message : String(err);

      logger.error(
        `Queue: task failed [${meta.id}] "${meta.label}" — ${meta.error}`,
      );
      eventBus.emit("taskFailed", {
        taskId: meta.id,
        messageId: meta.messageId,
        error: meta.error,
      });

      entry.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.activeTasks.delete(meta.id);
      this.tick();
      this.checkDrain();
    }
  }

  private drainResolvers: Array<() => void> = [];

  private checkDrain(): void {
    if (this.queue.length === 0 && this.activeTasks.size === 0) {
      for (const resolve of this.drainResolvers) {
        resolve();
      }
      this.drainResolvers = [];
    }
  }

  drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeTasks.size === 0) {
      return Promise.resolve();
    }
    this._accepting = false;
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  resume(): void {
    this._accepting = true;
  }

  getTask(id: string): QueuedTask | undefined {
    return this.allTasks.get(id);
  }

  pendingCount(): number {
    return this.queue.length;
  }

  activeCount(): number {
    return this.activeTasks.size;
  }

  totalCount(): number {
    return this.allTasks.size;
  }

  isIdle(): boolean {
    return this.queue.length === 0 && this.activeTasks.size === 0;
  }

  stats(): {
    pending: number;
    active: number;
    total: number;
    concurrency: number;
    accepting: boolean;
  } {
    return {
      pending: this.queue.length,
      active: this.activeTasks.size,
      total: this.allTasks.size,
      concurrency: this.concurrency,
      accepting: this._accepting,
    };
  }
}

export const taskQueue = new TaskQueue(1);
