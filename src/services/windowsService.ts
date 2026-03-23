/**
 * windowsService.ts
 *
 * Manages kassar-agent as a Windows Service via sc.exe.
 * All functions throw with a clear message on non-Windows platforms.
 *
 * PRODUCTION NOTE: The service runs the agent via `node + tsx`.
 * For locked-down production environments, pre-compile to JS first
 * and update `scriptPath` to point to the compiled entry point.
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
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

// ─── Defaults ────────────────────────────────────────────────────────────────

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

// ─── sc.exe helpers ───────────────────────────────────────────────────────────

/**
 * Query service state via `sc query` + `sc qc`.
 * Returns safe defaults (not installed) on any failure.
 */
function scQuery(serviceName: string): { installed: boolean; state: string; startType: string } {
  const queryResult = spawnSync("sc", ["query", serviceName], {
    encoding: "buffer",
    windowsHide: true,
  });

  // Decode output — Windows may use CP1256/OEM; convert to string safely
  const rawOut = queryResult.stdout
    ? queryResult.stdout.toString("utf8").replace(/\r/g, "")
    : "";
  const rawErr = queryResult.stderr
    ? queryResult.stderr.toString("utf8")
    : "";

  // sc query exits non-zero OR output contains "FAILED" / "1060" when not installed
  const notInstalled =
    queryResult.status !== 0 ||
    rawOut.includes("FAILED")    ||
    rawErr.includes("FAILED")    ||
    rawOut.includes("1060")      ||
    rawErr.includes("1060")      ||
    rawOut.trim().length === 0;

  if (notInstalled) {
    return { installed: false, state: "NOT_INSTALLED", startType: "unknown" };
  }

  const stateMatch = rawOut.match(/STATE\s*:\s*\d+\s+(\w+)/);
  const state      = stateMatch?.[1] ?? "UNKNOWN";

  // Query config for start type
  const qcResult = spawnSync("sc", ["qc", serviceName], {
    encoding: "buffer",
    windowsHide: true,
  });
  const qcOut      = qcResult.stdout ? qcResult.stdout.toString("utf8") : "";
  const startMatch = qcOut.match(/START_TYPE\s*:\s*\d+\s+([\w_]+)/);
  const startType  = startMatch?.[1] ?? "UNKNOWN";

  return { installed: true, state, startType };
}

/**
 * Build the binPath string for `sc create`.
 *
 * sc.exe expects: binPath= "C:\node.exe" "C:\tsx.cmd" "C:\cli\index.ts" start --foreground
 *
 * Notes:
 * - tsx.cmd is preferred; falls back to tsx (must be on PATH)
 * - Paths with spaces must be individually double-quoted inside the binPath
 */
function buildBinPath(scriptPath: string): string {
  const nodeExe = process.execPath;

  const tsxCmd = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx.cmd");
  const tsxSh  = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const tsxBin = existsSync(tsxCmd) ? tsxCmd : existsSync(tsxSh) ? tsxSh : "tsx";

  // Each component is individually quoted to handle spaces in paths
  return `"${nodeExe}" "${tsxBin}" "${scriptPath}" start --foreground`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getServiceStatus(cfg: WindowsServiceConfig = defaultServiceConfig): ServiceStatus {
  logger.debug("[SERVICE] status checked");

  if (!isWindows()) {
    return {
      installed: false,
      running:   false,
      autoStart: false,
      state:     "NOT_SUPPORTED",
      error:     `Windows service support is not available on ${process.platform}.`,
    };
  }

  const { installed, state, startType } = scQuery(cfg.serviceName);
  return {
    installed,
    running:   state === "RUNNING",
    autoStart: startType === "AUTO_START",
    state,
    startType,
  };
}

export function installService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("install");
  logger.info(`[SERVICE] install requested — name=${cfg.serviceName}`);

  // Refuse to install if already registered
  const { installed } = scQuery(cfg.serviceName);
  if (installed) {
    throw new Error(
      `Service "${cfg.serviceName}" is already installed.\n` +
      `Run: kassar service uninstall  — then install again.`
    );
  }

  const binPath   = buildBinPath(cfg.scriptPath);
  const startType = cfg.autoStart ? "auto" : "demand";

  // sc.exe arg format: key= value  (space required between = and value)
  const { status, stderr } = spawnSync(
    "sc",
    [
      "create", cfg.serviceName,
      "binPath=", binPath,
      "DisplayName=", cfg.displayName,
      "start=", startType,
    ],
    { encoding: "utf8", windowsHide: true }
  );

  if (status !== 0) {
    const detail = stderr?.trim() || "sc.exe returned non-zero exit code";
    const msg    = `Failed to install service "${cfg.serviceName}": ${detail}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  // Set description (non-critical — log warn on failure, don't abort)
  const descResult = spawnSync(
    "sc",
    ["description", cfg.serviceName, cfg.description],
    { encoding: "utf8", windowsHide: true }
  );
  if (descResult.status !== 0) {
    logger.warn(`[SERVICE] could not set description for "${cfg.serviceName}"`);
  }

  logger.info(`[SERVICE] installed — name=${cfg.serviceName} autoStart=${cfg.autoStart}`);
}

export function uninstallService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("uninstall");
  logger.info(`[SERVICE] uninstall requested — name=${cfg.serviceName}`);

  const { installed, state } = scQuery(cfg.serviceName);
  if (!installed) {
    throw new Error(`Service "${cfg.serviceName}" is not installed.`);
  }

  // Stop if running before deleting
  if (state === "RUNNING") {
    logger.info(`[SERVICE] stopping before uninstall — name=${cfg.serviceName}`);
    const stopResult = spawnSync("sc", ["stop", cfg.serviceName], { encoding: "utf8", windowsHide: true });
    if (stopResult.status !== 0) {
      logger.warn(`[SERVICE] could not stop service before uninstall (will attempt delete anyway)`);
    }
    // Brief polling wait — sc delete may fail if service hasn't fully stopped
    waitForState(cfg.serviceName, "STOPPED", 5000);
  }

  const { status, stderr } = spawnSync("sc", ["delete", cfg.serviceName], { encoding: "utf8", windowsHide: true });
  if (status !== 0) {
    const detail = stderr?.trim() || "sc.exe returned non-zero exit code";
    const msg    = `Failed to uninstall service "${cfg.serviceName}": ${detail}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] uninstalled — name=${cfg.serviceName}`);
}

export function startService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("start");
  logger.info(`[SERVICE] start requested — name=${cfg.serviceName}`);

  const { installed, state } = scQuery(cfg.serviceName);
  if (!installed) {
    throw new Error(
      `Service "${cfg.serviceName}" is not installed.\nRun: kassar service install`
    );
  }
  if (state === "RUNNING") {
    throw new Error(`Service "${cfg.serviceName}" is already running.`);
  }

  const { status, stderr } = spawnSync("sc", ["start", cfg.serviceName], { encoding: "utf8", windowsHide: true });
  if (status !== 0) {
    const detail = stderr?.trim() || "sc.exe returned non-zero exit code";
    const msg    = `Failed to start service "${cfg.serviceName}": ${detail}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] started — name=${cfg.serviceName}`);
}

export function stopService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("stop");
  logger.info(`[SERVICE] stop requested — name=${cfg.serviceName}`);

  const { installed, state } = scQuery(cfg.serviceName);
  if (!installed) {
    throw new Error(`Service "${cfg.serviceName}" is not installed.`);
  }
  if (state !== "RUNNING") {
    throw new Error(`Service "${cfg.serviceName}" is not running (state: ${state}).`);
  }

  const { status, stderr } = spawnSync("sc", ["stop", cfg.serviceName], { encoding: "utf8", windowsHide: true });
  if (status !== 0) {
    const detail = stderr?.trim() || "sc.exe returned non-zero exit code";
    const msg    = `Failed to stop service "${cfg.serviceName}": ${detail}`;
    logger.error(`[SERVICE] error — ${msg}`);
    throw new Error(msg);
  }

  logger.info(`[SERVICE] stopped — name=${cfg.serviceName}`);
}

export function restartService(cfg: WindowsServiceConfig = defaultServiceConfig): void {
  requireWindows("restart");
  logger.info(`[SERVICE] restart requested — name=${cfg.serviceName}`);

  const { installed, state } = scQuery(cfg.serviceName);
  if (!installed) {
    throw new Error(`Service "${cfg.serviceName}" is not installed.`);
  }

  if (state === "RUNNING") {
    stopService(cfg);
    const stopped = waitForState(cfg.serviceName, "STOPPED", 8000);
    if (!stopped) {
      throw new Error(
        `Service "${cfg.serviceName}" did not stop within 8 seconds. Restart aborted.`
      );
    }
  }

  startService(cfg);
  logger.info(`[SERVICE] restarted — name=${cfg.serviceName}`);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Busy-poll until the service reaches the target state or the deadline passes.
 * Uses Atomics.wait to avoid spinning at 100% CPU.
 * Returns true if the target state was reached, false on timeout.
 */
function waitForState(serviceName: string, targetState: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  const shared   = new SharedArrayBuffer(4);
  const arr      = new Int32Array(shared);

  while (Date.now() < deadline) {
    const { state } = scQuery(serviceName);
    if (state === targetState) return true;
    // Wait up to 500ms between polls without spinning
    Atomics.wait(arr, 0, 0, 500);
  }
  return false;
}
