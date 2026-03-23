import { logger } from "../utils/logger.js";

export interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  timestamp: number;
  ttl?: number;
}

export class MemoryStore {
  private store: Map<string, MemoryEntry> = new Map();

  set(key: string, value: unknown, ttlMs?: number): void {
    const entry: MemoryEntry = {
      id: `mem_${Date.now().toString(36)}`,
      key,
      value,
      timestamp: Date.now(),
      ttl: ttlMs,
    };
    this.store.set(key, entry);
    logger.debug(`Memory set: ${key}`);
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      logger.debug(`Memory expired: ${key}`);
      return undefined;
    }

    return entry.value as T;
  }

  has(key: string): boolean {
    const val = this.get(key);
    return val !== undefined;
  }

  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    if (deleted) {
      logger.debug(`Memory deleted: ${key}`);
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
    logger.debug("Memory cleared");
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  size(): number {
    return this.store.size;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug(`Memory cleanup: removed ${removed} expired entries`);
    }
    return removed;
  }
}

export const memoryStore = new MemoryStore();
