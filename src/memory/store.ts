import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const STORE_LOG  = (msg: string) => logger.debug(`[MEMORY:store] ${msg}`);
const STORE_WARN = (msg: string) => logger.warn(`[MEMORY:store] ${msg}`);

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    STORE_LOG(`created directory: ${dirPath}`);
  }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    STORE_WARN(`failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): boolean {
  try {
    ensureDir(path.dirname(filePath));
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    STORE_LOG(`wrote: ${filePath}`);
    return true;
  } catch (err) {
    STORE_WARN(`failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function appendJsonArray<T>(filePath: string, entry: T, maxEntries = 200): boolean {
  try {
    const existing = readJson<T[]>(filePath, []);
    const updated  = [...existing, entry].slice(-maxEntries);
    return writeJson(filePath, updated);
  } catch (err) {
    STORE_WARN(`appendJsonArray failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function readJsonArray<T>(filePath: string): T[] {
  return readJson<T[]>(filePath, []);
}
