import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, "..", "..");
const PID_FILE = resolve(PROJECT_ROOT, "logs", "agent.pid");
const GATEWAY_ENTRY = resolve(PROJECT_ROOT, "src", "core", "gateway.ts");

function ensureLogsDir(): void {
  const logsDir = resolve(PROJECT_ROOT, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

export function writePid(pid: number): void {
  ensureLogsDir();
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

export function removePid(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface AgentStatus {
  running: boolean;
  pid: number | null;
  pidFile: string;
}

export function getAgentStatus(): AgentStatus {
  const pid = readPid();
  if (pid === null) {
    return { running: false, pid: null, pidFile: PID_FILE };
  }
  const running = isProcessAlive(pid);
  if (!running) {
    removePid();
  }
  return { running, pid: running ? pid : null, pidFile: PID_FILE };
}

export function startAgent(): { pid: number } {
  const status = getAgentStatus();
  if (status.running && status.pid !== null) {
    logger.warn(`Agent already running (PID ${status.pid})`);
    return { pid: status.pid };
  }

  const tsxBin = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const bin = existsSync(tsxBin) ? tsxBin : "tsx";

  const child = spawn(bin, [GATEWAY_ENTRY], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  if (child.pid === undefined) {
    throw new Error("Failed to spawn agent process — no PID assigned");
  }

  child.unref();
  writePid(child.pid);
  logger.info(`Agent started (PID ${child.pid})`);
  return { pid: child.pid };
}

export function stopAgent(): { stopped: boolean; pid: number | null } {
  const status = getAgentStatus();
  if (!status.running || status.pid === null) {
    logger.warn("Agent is not running");
    return { stopped: false, pid: null };
  }

  try {
    process.kill(status.pid, "SIGTERM");
    removePid();
    logger.info(`Agent stopped (PID ${status.pid})`);
    return { stopped: true, pid: status.pid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to stop agent: ${msg}`);
    removePid();
    return { stopped: false, pid: status.pid };
  }
}
