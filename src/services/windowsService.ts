/**
 * windowsService.ts
 *
 * Manages kassar-agent auto-start via Windows Task Scheduler (schtasks.exe).
 * Task Scheduler works with ANY executable — no Windows Service protocol needed.
 *
 * Task name : KassarAgent
 * Trigger   : At user logon (ONLOGON)
 * Action    : cmd /c kassar.cmd start
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WindowsServiceConfig {
  serviceName: string;
  displayName: string;
  description: string;
  autoStart:   boolean;
  scriptPath:  string;
}

export interface ServiceStatus {
  installed:  boolean;
  running:    boolean;
  autoStart:  boolean;
  state?:     string;
  startType?: string;
  error?:     string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultServiceConfig: WindowsServiceConfig = {
  serviceName: "KassarAgent",
  displayName: "Kassar Agent",
  description: "Autonomous AI agent with Telegram adapter and persistent memory.",
  autoStart:   true,
  scriptPath:  resolve(PROJECT_ROOT, "cli", "index.ts"),
};

// ─── Platform guard ───────────────────────────────────────────────────────────

function isWindows(): boolean {
  return process.platform === "win32";
}

function requireWindows(operation: string): void {
  if (!isWindows()) {
    throw new Error(
      `"kassar service ${operation}" is only supported on Windows.\n` +
      `Current platform: ${process.platform}`
    );
  }
}

// ─── Task Scheduler helpers ───────────────────────────────────────────────────

function queryTask(taskName: string): { exists: boolean; status: string } {
  const result = spawnSync(
    "schtasks",
    ["/Query", "/TN", taskName, "/FO", "CSV", "/NH"],
    { encoding: "buffer", windowsHide: true }
  );

  const stdout  = result.stdout ? result.stdout.toString("utf8") : "";
  const stderr  = result.stderr ? result.stderr.toString("utf8") : "";
  const notFound =
    result.status !== 0 ||
    stderr.toLowerCase().includes("error") ||
    stdout.trim().length === 0;

  if (notFound) return { exists: false, status: "NOT_FOUND" };

  // CSV line: "\\TaskName","Next Run Time","Status"
  const parts     = stdout.trim().split(",");
  const rawStatus = (parts[2] ?? "Unknown").replace(/"/g, "").trim();
  return { exists: true, status: rawStatus };
}

/** Path to kassar.cmd — lives one level up from src/ in bin/ */
function kassarCmdPath(): string {
  return resolve(PROJECT_ROOT, "..", "bin", "kassar.cmd");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getServiceStatus(cfg: WindowsServiceConfig = defaultServiceConfig): ServiceStatus {
  if (!isWindows()) {
    return {
      installed: false,
      running:   false,
      autoStart: false,
      state:     "NOT_SUPPORTED",
      error:     "Task Scheduler support is only available on Windows.",
    };
  }

  const { exists, status } = queryTask(cfg.serviceName);
  logger.debug(`[SERVICE] status: task=${cfg.serviceName} exists=${exists} status=${status}`);

  return {
    installed: exists,
    running:   status === "Running",
    autoStart: exists,
    state:     exists ? status : "NOT_INSTALLED",
    startType: exists ? "ONLOGON" : "unknown",
  };
}

export function installService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("install");
  logger.info(`[SERVICE] install requested — name=${cfg.serviceName}`);

  const { exists } = queryTask(cfg.serviceName);
  if (exists) {
    throw new Error(
      `Task "${cfg.serviceName}" is already installed.\n` +
      `Run: kassar service uninstall  — then install again.`
    );
  }

  const cmdPath  = kassarCmdPath();
  const taskCmd  = existsSync(cmdPath)
    ? `cmd /c "${cmdPath}" start`
    : `cmd /c kassar start`;

  const { status, stderr } = spawnSync(
    "schtasks",
    [
      "/Create",
      "/SC",  "ONLOGON",
      "/TN",  cfg.serviceName,
      "/TR",  taskCmd,
      "/RL",  "HIGHEST",
      "/F",
    ],
    { encoding: "buffer", windowsHide: true }
  );

  const errOut = stderr ? stderr.toString("utf8").trim() : "";
  if (status !== 0) {
    const msg = `Failed to create scheduled task "${cfg.serviceName}": ${errOut || "schtasks returned non-zero exit code"}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] installed — name=${cfg.serviceName} trigger=ONLOGON`);
}

export function uninstallService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("uninstall");
  logger.info(`[SERVICE] uninstall requested — name=${cfg.serviceName}`);

  const { exists } = queryTask(cfg.serviceName);
  if (!exists) throw new Error(`Task "${cfg.serviceName}" is not installed.`);

  const { status, stderr } = spawnSync(
    "schtasks",
    ["/Delete", "/TN", cfg.serviceName, "/F"],
    { encoding: "buffer", windowsHide: true }
  );

  const errOut = stderr ? stderr.toString("utf8").trim() : "";
  if (status !== 0) {
    const msg = `Failed to delete task "${cfg.serviceName}": ${errOut}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] uninstalled — name=${cfg.serviceName}`);
}

export function startService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("start");
  logger.info(`[SERVICE] start requested — name=${cfg.serviceName}`);

  const { exists } = queryTask(cfg.serviceName);
  if (!exists) {
    throw new Error(
      `Task "${cfg.serviceName}" is not installed.\nRun: kassar service install`
    );
  }

  // /Run triggers the task immediately (runs kassar start in background)
  const { status, stderr } = spawnSync(
    "schtasks",
    ["/Run", "/TN", cfg.serviceName],
    { encoding: "buffer", windowsHide: true }
  );

  const errOut = stderr ? stderr.toString("utf8").trim() : "";
  if (status !== 0) {
    const msg = `Failed to run task "${cfg.serviceName}": ${errOut || "schtasks returned non-zero exit code"}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] started — name=${cfg.serviceName}`);
}

export function stopService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("stop");
  logger.info(`[SERVICE] stop requested — name=${cfg.serviceName}`);

  const { exists } = queryTask(cfg.serviceName);
  if (!exists) throw new Error(`Task "${cfg.serviceName}" is not installed.`);

  // /End terminates a currently running instance of the task
  const { status, stderr } = spawnSync(
    "schtasks",
    ["/End", "/TN", cfg.serviceName],
    { encoding: "buffer", windowsHide: true }
  );

  const errOut = stderr ? stderr.toString("utf8").trim() : "";
  if (status !== 0) {
    const msg = `Failed to stop task "${cfg.serviceName}": ${errOut}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] stopped — name=${cfg.serviceName}`);
}

export function restartService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("restart");
  logger.info(`[SERVICE] restart requested — name=${cfg.serviceName}`);

  try { stopService(cfg); } catch { /* ignore if not running */ }
  startService(cfg);

  logger.info(`[SERVICE] restarted — name=${cfg.serviceName}`);
}
