/**
 * dashboardServer.ts
 *
 * Serves the kassar-dashboard at http://127.0.0.1:22022  (LOCAL ONLY).
 *
 * Priority:
 *   1. If dashboard-dist/index.html exists → serve pre-built React app
 *   2. Otherwise                           → serve built-in status page
 *
 * Binds only to 127.0.0.1 — never reachable from the network.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream, existsSync, readFileSync, statSync } from "fs";
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

// ─── Fallback embedded page ───────────────────────────────────────────────────

function getConfig() {
  try {
    const p = resolve(PROJECT_ROOT, "config.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return { agent: { name: "kassar-agent", version: "1.0.0" }, telegram: { botToken: "" } };
}

function buildFallbackHTML(port: number): string {
  const cfg        = getConfig();
  const agentName  = cfg?.agent?.name    ?? "kassar-agent";
  const version    = cfg?.agent?.version ?? "1.0.0";
  const hasTelegram = !!(cfg?.telegram?.botToken);
  const now        = new Date().toLocaleString("ar-SA");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kassar Agent — لوحة التحكم</title>
<style>
  :root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--text:#c9d1d9;--muted:#8b949e}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;padding:24px}
  .header{display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:24px}
  .logo{font-size:28px;font-weight:700;color:var(--accent)}
  .badge{background:var(--surface);border:1px solid var(--border);color:var(--muted);padding:2px 10px;border-radius:20px;font-size:12px}
  .local-badge{background:#1a2d1a;border:1px solid #2ea043;color:var(--green);padding:2px 10px;border-radius:20px;font-size:12px;margin-right:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px}
  .card h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
  .status-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .dot{width:10px;height:10px;border-radius:50%}
  .dot.green{background:var(--green);box-shadow:0 0 8px var(--green)}
  .dot.yellow{background:var(--yellow);box-shadow:0 0 8px var(--yellow)}
  .dot.red{background:var(--red);box-shadow:0 0 8px var(--red)}
  .cmd{background:#0d1117;border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;font-family:Consolas,monospace;font-size:13px;color:#79c0ff;display:flex;align-items:center;justify-content:space-between;gap:8px}
  .btn{background:var(--surface);border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap}
  .btn:hover{border-color:var(--accent);color:var(--accent)}
  .info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px}
  .info-row:last-child{border-bottom:none}
  .muted{color:var(--muted)}
  .notice{background:#111d11;border:1px solid #2ea043;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:var(--green)}
  footer{margin-top:32px;text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--border);padding-top:20px}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="header">
  <div class="logo">kassar</div>
  <span class="badge">v${version}</span>
  <span class="local-badge">&#128274; محلي فقط</span>
</div>
<div class="notice">&#9989; هذه اللوحة تعمل على جهازك فقط (127.0.0.1:${port}) — لا أحد يصل إليها من الإنترنت</div>
<div class="grid">
  <div class="card">
    <h3>حالة الوكيل</h3>
    <div class="status-row"><div class="dot ${hasTelegram ? 'green' : 'yellow'}"></div><span>${hasTelegram ? 'جاهز' : 'يحتاج إعداد Telegram'}</span></div>
    <div style="font-size:20px;font-weight:700">${agentName}</div>
  </div>
  <div class="card">
    <h3>Telegram</h3>
    <div class="status-row"><div class="dot ${hasTelegram ? 'green' : 'red'}"></div><span style="color:${hasTelegram ? 'var(--green)' : 'var(--red)'}">${hasTelegram ? 'مُفعَّل' : 'غير مُعدّ'}</span></div>
    ${!hasTelegram ? '<div style="margin-top:8px;font-size:13px;color:var(--muted)">شغّل: <code style="color:#79c0ff">kassar telegram connect</code></div>' : ''}
  </div>
  <div class="card">
    <h3>النظام</h3>
    <div class="info-row"><span class="muted">الإصدار</span><span>${version}</span></div>
    <div class="info-row"><span class="muted">المنفذ</span><span>${port}</span></div>
    <div class="info-row"><span class="muted">التحديث</span><span style="font-size:12px">${now}</span></div>
  </div>
</div>
<div class="card">
  <h3>أوامر سريعة</h3>
  <div style="margin-top:8px">
    ${["kassar start","kassar stop","kassar status","kassar telegram connect","kassar doctor","kassar logs -f","kassar service install","kassar service start"].map(c =>
      `<div class="cmd"><span>${c}</span><button class="btn" onclick="copy(this,'${c}')">نسخ</button></div>`
    ).join("")}
  </div>
</div>
<footer>
  <p>kassar-agent v${version} — <a href="https://kassar-agent.replit.app" target="_blank">kassar-agent.replit.app</a></p>
</footer>
<script>
function copy(btn,text){navigator.clipboard.writeText(text).then(()=>{const o=btn.textContent;btn.textContent='تم!';btn.style.color='#3fb950';setTimeout(()=>{btn.textContent=o;btn.style.color=''},1500)})}
setTimeout(()=>location.reload(),30000);
</script>
</body>
</html>`;
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

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  private get hasBuild(): boolean {
    return existsSync(join(DASHBOARD_DIST, "index.html"));
  }

  start(): Promise<void> {
    return new Promise((res, rej) => {
      this.server = createServer((req: IncomingMessage, response: ServerResponse) => {
        this.handle(req, response);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          rej(new Error(`Port ${this.port} already in use — visit ${this.url}`));
        } else {
          rej(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        const mode = this.hasBuild ? "React app" : "built-in page";
        logger.info(`[DASHBOARD] serving ${mode} at ${this.url} (local only)`);
        if (this.autoOpen) this.openBrowser();
        res();
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info("[DASHBOARD] server stopped");
    }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    // Simple JSON API for status
    if (req.url === "/api/status") {
      const cfg = getConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, config: cfg }));
      return;
    }

    // If React build exists — serve it
    if (this.hasBuild) {
      this.serveStatic(req, res);
      return;
    }

    // Fallback: serve embedded HTML
    const html = buildFallbackHTML(this.port);
    res.writeHead(200, {
      "Content-Type":    "text/html; charset=utf-8",
      "Cache-Control":   "no-cache",
      "X-Frame-Options": "DENY",
    });
    res.end(html);
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse): void {
    let pathname = req.url?.split("?")[0] ?? "/";
    let filePath = join(DASHBOARD_DIST, pathname);

    // SPA fallback
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

  private openBrowser(): void {
    try {
      if (process.platform === "win32") {
        spawnSync("cmd", ["/c", "start", "", this.url], { shell: false });
      } else if (process.platform === "darwin") {
        spawnSync("open", [this.url]);
      } else {
        spawnSync("xdg-open", [this.url]);
      }
    } catch {
      logger.debug(`[DASHBOARD] could not auto-open — visit ${this.url}`);
    }
  }
}
