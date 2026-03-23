/**
 * dashboardServer.ts
 *
 * Serves the pre-built kassar-dashboard as a local static web server.
 * Started by `kassar dashboard` command, or when agent boots with autoOpen.
 *
 * Dashboard build output: <project-root>/dashboard-dist/
 * (Vite static output — no runtime dependencies needed)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import { resolve, extname, dirname, join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
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
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".map":  "application/json",
};

export interface DashboardServerOptions {
  port?:     number;
  host?:     string;
  autoOpen?: boolean;
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

  static isBuilt(): boolean {
    return existsSync(join(DASHBOARD_DIST, "index.html"));
  }

  start(): Promise<void> {
    return new Promise((res, rej) => {
      if (!DashboardServer.isBuilt()) {
        rej(new Error(
          `Dashboard build not found at: ${DASHBOARD_DIST}\n` +
          `Build it first: pnpm --filter @workspace/kassar-dashboard build`
        ));
        return;
      }

      this.server = createServer((req: IncomingMessage, response: ServerResponse) => {
        this.handleRequest(req, response);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.warn(`[DASHBOARD] port ${this.port} already in use`);
          rej(new Error(
            `Port ${this.port} is already in use.\n` +
            `The dashboard may already be running — visit ${this.url}`
          ));
        } else {
          rej(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        logger.info(`[DASHBOARD] serving at ${this.url}`);
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

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    let pathname = req.url?.split("?")[0] ?? "/";

    // Strip Vite base prefix if present
    if (pathname.startsWith("/kassar-dashboard")) {
      pathname = pathname.slice("/kassar-dashboard".length) || "/";
    }

    let filePath = join(DASHBOARD_DIST, pathname);

    // SPA fallback: no extension or file not found → serve index.html
    const hasExt = extname(pathname).length > 0;
    if (!hasExt || !existsSync(filePath)) {
      filePath = join(DASHBOARD_DIST, "index.html");
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext      = extname(filePath).toLowerCase();
    const mime     = MIME[ext] ?? "application/octet-stream";
    const size     = statSync(filePath).size;

    res.writeHead(200, {
      "Content-Type":   mime,
      "Content-Length": size,
      // Long cache for hashed assets, no-cache for HTML
      "Cache-Control":  ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });

    createReadStream(filePath).pipe(res);
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
      logger.debug(`[DASHBOARD] auto-opened browser at ${url}`);
    } catch {
      logger.debug(`[DASHBOARD] could not auto-open browser — visit ${url}`);
    }
  }
}
