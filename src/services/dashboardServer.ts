/**
 * dashboardServer.ts
 *
 * Serves the kassar-dashboard at http://127.0.0.1:22022 (LOCAL ONLY).
 * Provides real API endpoints that read/write local config, logs, memory files.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "fs";
import { resolve, extname, dirname, join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename     = fileURLToPath(import.meta.url);
const __dirname      = dirname(__filename);
const PROJECT_ROOT   = resolve(__dirname, "../../");
const DASHBOARD_DIST = resolve(PROJECT_ROOT, "dashboard-dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
};

export interface DashboardServerOptions {
  port?:     number;
  host?:     string;
  autoOpen?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch { return null; }
}

function readText(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch { return null; }
}

function readPid(): number | null {
  const pidFile = resolve(PROJECT_ROOT, "logs", "agent.pid");
  const raw = readText(pidFile);
  if (!raw) return null;
  const pid = parseInt(raw.trim(), 10);
  return isNaN(pid) ? null : pid;
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end",  () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control":               "no-cache",
  });
  res.end(body);
}

function err(res: ServerResponse, message: string, status = 500): void {
  json(res, { ok: false, error: message }, status);
}

// ─── API Handlers ─────────────────────────────────────────────────────────────

function handleStatus(res: ServerResponse): void {
  const cfg      = readJson(resolve(PROJECT_ROOT, "config.json")) as Record<string, unknown> | null;
  const pid      = readPid();
  const running  = pid !== null && isProcessAlive(pid);
  const telegram = (cfg?.telegram as Record<string, unknown>) ?? {};
  const agent    = (cfg?.agent   as Record<string, unknown>) ?? {};

  json(res, {
    ok: true,
    running,
    pid:      running ? pid : null,
    version:  agent.version ?? "1.0.0",
    name:     agent.name    ?? "kassar-agent",
    telegram: {
      configured: !!(telegram.botToken),
      chatId:     telegram.chatId ?? "",
    },
    logLevel: (cfg?.logging as Record<string, unknown>)?.level ?? "info",
    platform: process.platform,
  });
}

function handleGetConfig(res: ServerResponse): void {
  const cfg = readJson(resolve(PROJECT_ROOT, "config.json"));
  if (!cfg) return err(res, "config.json not found", 404);
  json(res, { ok: true, config: cfg });
}

async function handlePutConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body   = await parseBody(req);
    const parsed = JSON.parse(body);
    const cfgPath = resolve(PROJECT_ROOT, "config.json");
    writeFileSync(cfgPath, JSON.stringify(parsed, null, 2), "utf-8");
    json(res, { ok: true });
  } catch (e) {
    err(res, `Failed to save config: ${e instanceof Error ? e.message : e}`);
  }
}

function handleGetLogs(req: IncomingMessage, res: ServerResponse): void {
  const url    = new URL(req.url ?? "/", "http://localhost");
  const lines  = parseInt(url.searchParams.get("lines") ?? "200", 10);
  const logPath = resolve(PROJECT_ROOT, "logs", "app.log");

  if (!existsSync(logPath)) {
    return json(res, { ok: true, logs: [] });
  }

  try {
    const raw     = readFileSync(logPath, "utf-8");
    const allLines = raw.split("\n").filter(l => l.trim().length > 0);
    const tail    = allLines.slice(-lines);

    const parsed = tail.map((line, i) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return {
          id:      String(i),
          ts:      obj["timestamp"] as string ?? new Date().toISOString(),
          level:   ((obj["level"] as string) ?? "info").toLowerCase(),
          source:  extractSource(obj["message"] as string ?? ""),
          msg:     obj["message"] as string ?? line,
        };
      } catch {
        return { id: String(i), ts: new Date().toISOString(), level: "info", source: "APP", msg: line };
      }
    });

    json(res, { ok: true, logs: parsed });
  } catch (e) {
    err(res, `Failed to read logs: ${e instanceof Error ? e.message : e}`);
  }
}

function extractSource(msg: string): string {
  const m = msg.match(/\[([A-Z_]+)\]/);
  return m ? m[1] : "APP";
}

function handleGetMemory(res: ServerResponse): void {
  const memDir = resolve(PROJECT_ROOT, "memory");

  const readJsonFile = (p: string) => readJson(p);

  const user    = readJsonFile(join(memDir, "user.json"));
  const rules   = readRulesDir(join(memDir, "rules"));
  const sessions = readSessionsDir(join(memDir, "sessions"));
  const project = readJsonFile(join(memDir, "project.json"))
                ?? readFirstJsonIn(join(memDir, "projects"));

  json(res, { ok: true, memory: { user, rules, sessions, project } });
}

function readRulesDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const result: Record<string, string> = {};
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json")) {
        const content = readJson(join(dir, f));
        if (content && typeof content === "object") {
          Object.assign(result, content);
        }
      } else if (f.endsWith(".txt") || f.endsWith(".md")) {
        result[f.replace(/\.[^.]+$/, "")] = readText(join(dir, f)) ?? "";
      }
    }
  } catch { /* ignore */ }
  return result;
}

function readSessionsDir(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .slice(-20)
      .map(f => readJson(join(dir, f)))
      .filter(Boolean);
  } catch { return []; }
}

function readFirstJsonIn(dir: string): unknown {
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    if (files.length === 0) return null;
    return readJson(join(dir, files[0]));
  } catch { return null; }
}

function handleGetPrompts(res: ServerResponse): void {
  const promptsDir = resolve(PROJECT_ROOT, "prompts");
  const result: Record<string, string> = {};

  if (existsSync(promptsDir)) {
    try {
      for (const f of readdirSync(promptsDir)) {
        if (f.endsWith(".md") || f.endsWith(".txt")) {
          const key = f.replace(/\.[^.]+$/, "");
          result[key] = readText(join(promptsDir, f)) ?? "";
        }
      }
    } catch { /* ignore */ }
  }

  json(res, { ok: true, prompts: result });
}

async function handleAgentAction(
  req: IncomingMessage,
  res: ServerResponse,
  action: "start" | "stop"
): Promise<void> {
  try {
    if (action === "start") {
      const { startAgent } = await import("./process-manager.js");
      const { pid } = startAgent();
      json(res, { ok: true, pid });
    } else {
      const { stopAgent } = await import("./process-manager.js");
      const result = stopAgent();
      json(res, { ok: true, ...result });
    }
  } catch (e) {
    err(res, e instanceof Error ? e.message : String(e));
  }
}

// ─── DashboardServer ──────────────────────────────────────────────────────────

export class DashboardServer {
  private port:     number;
  private host:     string;
  private autoOpen: boolean;
  private server:   ReturnType<typeof createServer> | null = null;

  constructor(opts: DashboardServerOptions = {}) {
    this.port     = opts.port     ?? 22022;
    this.host     = opts.host     ?? "127.0.0.1";
    this.autoOpen = opts.autoOpen ?? true;
  }

  get url(): string { return `http://${this.host}:${this.port}`; }
  private get hasBuild(): boolean { return existsSync(join(DASHBOARD_DIST, "index.html")); }

  start(): Promise<void> {
    return new Promise((res, rej) => {
      this.server = createServer((req, response) => {
        this.handle(req, response).catch((e) => {
          logger.error(`[DASHBOARD] request error: ${e}`);
          if (!response.headersSent) {
            err(response, "Internal server error");
          }
        });
      });

      this.server.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE") rej(new Error(`Port ${this.port} already in use — visit ${this.url}`));
        else rej(e);
      });

      this.server.listen(this.port, this.host, () => {
        logger.info(`[DASHBOARD] at ${this.url} (local only, ${this.hasBuild ? "React app" : "built-in page"})`);
        if (this.autoOpen) this.openBrowser();
        res();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    logger.info("[DASHBOARD] stopped");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url    = req.url ?? "/";
    const method = req.method?.toUpperCase() ?? "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    // ── API routes ──────────────────────────────────────────────
    if (url.startsWith("/api/")) {
      if (url === "/api/status"   && method === "GET") { handleStatus(res); return; }
      if (url === "/api/config"   && method === "GET") { handleGetConfig(res); return; }
      if (url === "/api/config"   && method === "PUT") { await handlePutConfig(req, res); return; }
      if (url.startsWith("/api/logs") && method === "GET") { handleGetLogs(req, res); return; }
      if (url === "/api/memory"   && method === "GET") { handleGetMemory(res); return; }
      if (url === "/api/prompts"  && method === "GET") { handleGetPrompts(res); return; }
      if (url === "/api/agent/start" && method === "POST") { await handleAgentAction(req, res, "start"); return; }
      if (url === "/api/agent/stop"  && method === "POST") { await handleAgentAction(req, res, "stop"); return; }
      // /api/healthz — compatibility
      if (url === "/api/healthz") { json(res, { status: "ok" }); return; }

      err(res, "Not found", 404);
      return;
    }

    // ── Static files ────────────────────────────────────────────
    if (this.hasBuild) { this.serveStatic(url, res); return; }

    // ── Fallback: built-in status page ──────────────────────────
    this.serveFallback(res);
  }

  private serveStatic(url: string, res: ServerResponse): void {
    let pathname = url.split("?")[0];
    let filePath = join(DASHBOARD_DIST, pathname);

    const hasExt = extname(pathname).length > 0;
    if (!hasExt || !existsSync(filePath)) {
      filePath = join(DASHBOARD_DIST, "index.html");
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext  = extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    const size = statSync(filePath).size;

    res.writeHead(200, {
      "Content-Type":   mime,
      "Content-Length": size,
      "Cache-Control":  ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
  }

  private serveFallback(res: ServerResponse): void {
    const cfg        = readJson(resolve(PROJECT_ROOT, "config.json")) as Record<string, unknown> | null;
    const version    = (cfg?.agent as Record<string, unknown>)?.version ?? "1.0.0";
    const hasTelegram = !!(cfg?.telegram as Record<string, unknown>)?.botToken;
    const pid        = readPid();
    const running    = pid !== null && isProcessAlive(pid);
    const now        = new Date().toLocaleString("ar-SA");

    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><title>Kassar Agent</title>
<style>
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',Arial,sans-serif;padding:24px}
.logo{font-size:28px;font-weight:700;color:#58a6ff}.badge{background:#161b22;border:1px solid #30363d;color:#8b949e;padding:2px 10px;border-radius:20px;font-size:12px;margin-right:8px}
.notice{background:#111d11;border:1px solid #2ea043;border-radius:8px;padding:12px;margin:16px 0;color:#3fb950;font-size:13px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;margin-bottom:16px}
.cmd{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 14px;margin:6px 0;font-family:Consolas,monospace;font-size:13px;color:#79c0ff}
</style></head><body>
<div><span class="logo">kassar</span><span class="badge">v${version}</span><span class="badge" style="color:#3fb950;border-color:#2ea043">&#128274; محلي فقط</span></div>
<div class="notice">&#9989; يعمل على http://127.0.0.1:${this.port} — جهازك وحده</div>
<div class="card"><b>الحالة:</b> ${running ? '&#9989; يعمل' : '&#9940; متوقف'} | Telegram: ${hasTelegram ? '&#10003; مُعدّ' : '&#10007; غير مُعدّ'} | ${now}</div>
<div class="card"><b>API متاح:</b><br>
<div class="cmd">GET /api/status</div><div class="cmd">GET /api/config</div>
<div class="cmd">GET /api/logs?lines=100</div><div class="cmd">GET /api/memory</div>
<div class="cmd">POST /api/agent/start</div><div class="cmd">POST /api/agent/stop</div>
</div>
<script>setTimeout(()=>location.reload(),15000)</script>
</body></html>`;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
  }

  private openBrowser(): void {
    try {
      if (process.platform === "win32") {
        spawnSync("cmd", ["/c", "start", "", this.url], { shell: false });
      } else if (process.platform === "darwin") {
        spawnSync("open", [this.url]);
      } else {
        spawnSync("xdg-open", [this.url]);
      }
    } catch { /* ignore */ }
  }
}
