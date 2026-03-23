/**
 * dashboardServer.ts
 *
 * Serves a built-in local dashboard at http://127.0.0.1:22022
 * LOCAL ONLY — binds to 127.0.0.1, never exposed to the network.
 * No external build step required — HTML is embedded directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "../../");

export interface DashboardServerOptions {
  port?:     number;
  host?:     string;
  autoOpen?: boolean;
}

function getAgentInfo() {
  try {
    const cfgPath = resolve(PROJECT_ROOT, "config.json");
    if (existsSync(cfgPath)) {
      return JSON.parse(readFileSync(cfgPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return { agent: { name: "kassar-agent", version: "1.0.0" }, telegram: { botToken: "" } };
}

function buildDashboardHTML(port: number): string {
  const cfg        = getAgentInfo();
  const agentName  = cfg?.agent?.name    ?? "kassar-agent";
  const version    = cfg?.agent?.version ?? "1.0.0";
  const hasTelegram = !!(cfg?.telegram?.botToken);
  const now        = new Date().toLocaleString("ar-SA");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kassar Agent — لوحة التحكم</title>
<style>
  :root {
    --bg:      #0d1117;
    --surface: #161b22;
    --border:  #30363d;
    --accent:  #58a6ff;
    --green:   #3fb950;
    --yellow:  #d29922;
    --red:     #f85149;
    --text:    #c9d1d9;
    --muted:   #8b949e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    min-height: 100vh;
    padding: 24px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
    margin-bottom: 24px;
  }
  .logo {
    font-size: 28px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -1px;
  }
  .version-badge {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 12px;
  }
  .local-badge {
    background: #1a2d1a;
    border: 1px solid #2ea043;
    color: var(--green);
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 12px;
    margin-right: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
  }
  .card h3 {
    font-size: 13px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.green  { background: var(--green);  box-shadow: 0 0 8px var(--green); }
  .dot.yellow { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
  .dot.red    { background: var(--red);    box-shadow: 0 0 8px var(--red); }
  .stat-value { font-size: 22px; font-weight: 700; color: var(--text); }
  .stat-label { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .cmd-block {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 13px;
    color: #79c0ff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .cmd-block span { flex: 1; word-break: break-all; }
  .copy-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all .2s;
    white-space: nowrap;
  }
  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: var(--muted); }
  .info-value { font-weight: 500; }
  .tag-ok     { color: var(--green); }
  .tag-warn   { color: var(--yellow); }
  .tag-err    { color: var(--red); }
  .footer {
    margin-top: 32px;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    border-top: 1px solid var(--border);
    padding-top: 20px;
  }
  .local-notice {
    background: #111d11;
    border: 1px solid #2ea043;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--green);
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
</head>
<body>

<div class="header">
  <div class="logo">kassar</div>
  <span class="version-badge">v${version}</span>
  <span class="local-badge">&#128274; محلي فقط — 127.0.0.1</span>
</div>

<div class="local-notice">
  &#9989; هذه اللوحة تعمل على جهازك فقط — لا يمكن لأي شخص آخر الوصول إليها من الإنترنت
</div>

<div class="grid">

  <div class="card">
    <h3>حالة الوكيل</h3>
    <div class="status-row">
      <div class="dot ${hasTelegram ? 'green' : 'yellow'}"></div>
      <span>${hasTelegram ? 'جاهز للتشغيل' : 'يحتاج إعداد Telegram'}</span>
    </div>
    <div class="stat-value">${agentName}</div>
    <div class="stat-label">اسم الوكيل</div>
  </div>

  <div class="card">
    <h3>Telegram</h3>
    <div class="status-row">
      <div class="dot ${hasTelegram ? 'green' : 'red'}"></div>
      <span class="${hasTelegram ? 'tag-ok' : 'tag-err'}">${hasTelegram ? 'مُفعَّل' : 'غير مُعدّ'}</span>
    </div>
    ${!hasTelegram ? `<div style="margin-top:10px; font-size:13px; color:var(--muted);">
      شغّل: <code style="color:#79c0ff">kassar telegram connect</code>
    </div>` : ''}
  </div>

  <div class="card">
    <h3>معلومات النظام</h3>
    <div class="info-row">
      <span class="info-label">الإصدار</span>
      <span class="info-value">${version}</span>
    </div>
    <div class="info-row">
      <span class="info-label">المنفذ</span>
      <span class="info-value">${port}</span>
    </div>
    <div class="info-row">
      <span class="info-label">آخر تحديث</span>
      <span class="info-value" style="font-size:12px">${now}</span>
    </div>
  </div>

</div>

<div class="card" style="margin-bottom:16px">
  <h3>أوامر سريعة</h3>
  <div style="margin-top:8px">

    <div class="cmd-block">
      <span>kassar start</span>
      <button class="copy-btn" onclick="copy(this, 'kassar start')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar stop</span>
      <button class="copy-btn" onclick="copy(this, 'kassar stop')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar status</span>
      <button class="copy-btn" onclick="copy(this, 'kassar status')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar telegram connect</span>
      <button class="copy-btn" onclick="copy(this, 'kassar telegram connect')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar doctor</span>
      <button class="copy-btn" onclick="copy(this, 'kassar doctor')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar logs -f</span>
      <button class="copy-btn" onclick="copy(this, 'kassar logs -f')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar service install</span>
      <button class="copy-btn" onclick="copy(this, 'kassar service install')">نسخ</button>
    </div>
    <div class="cmd-block">
      <span>kassar service start</span>
      <button class="copy-btn" onclick="copy(this, 'kassar service start')">نسخ</button>
    </div>

  </div>
</div>

<div class="footer">
  <p>kassar-agent v${version} — يعمل محلياً على http://127.0.0.1:${port}</p>
  <p style="margin-top:4px">التوثيق: <a href="https://kassar-agent.replit.app" style="color:var(--accent)" target="_blank">kassar-agent.replit.app</a></p>
</div>

<script>
function copy(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'تم!';
    btn.style.color = '#3fb950';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
  });
}

// Auto-refresh every 30 seconds
setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;
}

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

  start(): Promise<void> {
    return new Promise((res, rej) => {
      this.server = createServer((req: IncomingMessage, response: ServerResponse) => {
        if (req.url === "/api/status") {
          const cfg = getAgentInfo();
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, config: cfg }));
          return;
        }

        const html = buildDashboardHTML(this.port);
        response.writeHead(200, {
          "Content-Type":   "text/html; charset=utf-8",
          "Cache-Control":  "no-cache",
          "X-Frame-Options": "DENY",
        });
        response.end(html);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          rej(new Error(
            `Port ${this.port} is already in use.\n` +
            `Dashboard may already be running — visit ${this.url}`
          ));
        } else {
          rej(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        logger.info(`[DASHBOARD] serving at ${this.url} (local only)`);
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

  private openBrowser(): void {
    const url = this.url;
    try {
      if (process.platform === "win32") {
        spawnSync("cmd", ["/c", "start", "", url], { shell: false });
      } else if (process.platform === "darwin") {
        spawnSync("open", [url]);
      } else {
        spawnSync("xdg-open", [url]);
      }
      logger.debug(`[DASHBOARD] opened browser at ${url}`);
    } catch {
      logger.debug(`[DASHBOARD] could not auto-open — visit ${url}`);
    }
  }
}
