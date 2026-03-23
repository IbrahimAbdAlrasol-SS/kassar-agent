import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { spawn as spawnProc } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";
import {
  loadConfig,
  writeConfig,
  CONFIG_PATH,
  getNestedValue,
  setNestedValue,
  type AgentConfig,
} from "../src/config/index.js";
import { logger } from "../src/utils/logger.js";
import {
  startAgent,
  stopAgent,
  getAgentStatus,
} from "../src/services/process-manager.js";
import {
  installService,
  uninstallService,
  startService,
  stopService,
  restartService,
  getServiceStatus,
  defaultServiceConfig,
} from "../src/services/windowsService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, "..");
const LOGS_DIR = resolve(PROJECT_ROOT, "logs");
const APP_LOG = resolve(LOGS_DIR, "app.log");
const WORKSPACE_DIR = resolve(PROJECT_ROOT, "workspace");
const DIST_DIR = resolve(PROJECT_ROOT, "dist");
const ENV_EXAMPLE = resolve(PROJECT_ROOT, ".env.example");
const ENV_FILE = resolve(PROJECT_ROOT, ".env");

const REQUIRED_DIRS = [LOGS_DIR, WORKSPACE_DIR, DIST_DIR];

function ok(msg: string): void {
  console.log(`  \x1b[32m✔\x1b[0m  ${msg}`);
}

function fail(msg: string): void {
  console.log(`  \x1b[31m✘\x1b[0m  ${msg}`);
}

function info(msg: string): void {
  console.log(`  \x1b[34m›\x1b[0m  ${msg}`);
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function prompt(question: string, secret = false): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (secret) {
      process.stdout.write(question);
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      let answer = "";

      const onData = (char: string) => {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolvePromise(answer);
        } else if (char === "\u0003") {
          process.stdin.setRawMode?.(false);
          process.exit(0);
        } else if (char === "\u007f") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + "*".repeat(answer.length));
          }
        } else {
          answer += char;
          process.stdout.write("*");
        }
      };

      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolvePromise(answer.trim());
      });
    }
  });
}

const program = new Command();

program
  .name("kassar")
  .description("kassar-agent — manage your AI agent from the command line")
  .version(loadConfig().agent.version);

program
  .command("install")
  .description("Set up all required directories and files for kassar-agent")
  .action(() => {
    logger.info("Running kassar install");
    section("Installing kassar-agent");

    let allOk = true;

    for (const dir of REQUIRED_DIRS) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        ok(`Created directory: ${dir}`);
      } else {
        ok(`Directory exists: ${dir}`);
      }
    }

    if (!existsSync(ENV_FILE)) {
      if (existsSync(ENV_EXAMPLE)) {
        const envContent = readFileSync(ENV_EXAMPLE, "utf-8");
        writeFileSync(ENV_FILE, envContent, "utf-8");
        ok("Created .env from .env.example");
      } else {
        writeFileSync(
          ENV_FILE,
          "NODE_ENV=development\nLOG_LEVEL=info\nAGENT_NAME=kassar-agent\n",
          "utf-8",
        );
        ok("Created .env with defaults");
      }
    } else {
      ok(".env already exists");
    }

    if (!existsSync(CONFIG_PATH)) {
      const defaultCfg: AgentConfig = loadConfig();
      writeConfig(defaultCfg);
      ok("Created config.json with defaults");
    } else {
      ok("config.json already exists");
    }

    if (!allOk) {
      console.log("\n\x1b[33mInstall completed with warnings.\x1b[0m");
      process.exit(1);
    }

    console.log(
      "\n\x1b[32mInstall complete.\x1b[0m Run \x1b[1mkassar start\x1b[0m to launch the agent.",
    );
    logger.info("kassar install completed");
  });

program
  .command("start")
  .description("Start the kassar-agent gateway as a background process")
  .option("--foreground", "Run in foreground (do not detach)")
  .option("--test", "Boot in foreground, fire test messages, print responses, then exit")
  .action(async (opts: { foreground?: boolean; test?: boolean }) => {
    logger.info("CLI: kassar start");

    if (opts.test) {
      await runForcedTest();
      return;
    }

    if (opts.foreground) {
      info("Starting kassar-agent in foreground...");
      const { boot } = await import("../src/core/gateway.js");
      const { startTelegramIfConfigured } = await import("../src/adapters/telegram/index.js");
      const gw = await boot();
      await startTelegramIfConfigured(gw);
      return;
    }

    const status = getAgentStatus();
    if (status.running && status.pid !== null) {
      info(`Agent is already running (PID ${status.pid})`);
      process.exit(0);
    }

    try {
      const { pid } = startAgent();
      ok(`Agent started   PID ${pid}`);
      info(`Logs → ${APP_LOG}`);
      info("Run \x1b[1mkassar status\x1b[0m to confirm.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Failed to start agent: ${msg}`);
      logger.error(`kassar start failed: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("stop")
  .description("Stop the running kassar-agent process")
  .action(() => {
    logger.info("CLI: kassar stop");

    const status = getAgentStatus();
    if (!status.running || status.pid === null) {
      info("Agent is not running.");
      process.exit(0);
    }

    const result = stopAgent();
    if (result.stopped) {
      ok(`Agent stopped   (was PID ${result.pid})`);
    } else {
      fail(`Could not stop agent (PID ${result.pid})`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Check whether the agent is running")
  .action(() => {
    logger.info("CLI: kassar status");
    const cfg = loadConfig();
    const status = getAgentStatus();

    section("Agent Status");
    console.log(`  Name     : ${cfg.agent.name}`);
    console.log(`  Version  : ${cfg.agent.version}`);
    console.log(
      `  Running  : ${status.running ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`,
    );
    if (status.pid !== null) {
      console.log(`  PID      : ${status.pid}`);
    }
    console.log(`  PID file : ${status.pidFile}`);
    console.log(`  Log file : ${APP_LOG}`);
    console.log(`  Workspace: ${cfg.workspace.dir}`);
    console.log();

    process.exit(status.running ? 0 : 1);
  });

program
  .command("doctor")
  .description("Check the health of the kassar-agent setup")
  .action(() => {
    logger.info("CLI: kassar doctor");
    const cfg = loadConfig();
    let passed = 0;
    let failed = 0;

    section("System Check");

    if (existsSync(CONFIG_PATH)) {
      ok("config.json exists");
      passed++;
    } else {
      fail("config.json not found — run kassar install");
      failed++;
    }

    const botToken = cfg.telegram.botToken || process.env["BOT_TOKEN"] || "";
    if (botToken.length > 0) {
      const masked =
        botToken.length > 8
          ? botToken.slice(0, 4) + "****" + botToken.slice(-4)
          : "****";
      ok(`Telegram bot token found (${masked})`);
      passed++;
    } else {
      fail("Telegram bot token not set — run kassar telegram connect");
      failed++;
    }

    for (const dir of REQUIRED_DIRS) {
      if (existsSync(dir)) {
        ok(`Directory exists: ${dir}`);
        passed++;
      } else {
        fail(`Missing directory: ${dir} — run kassar install`);
        failed++;
      }
    }

    if (existsSync(ENV_FILE)) {
      ok(".env file exists");
      passed++;
    } else {
      fail(".env file not found — run kassar install");
      failed++;
    }

    const status = getAgentStatus();
    if (status.running) {
      ok(`Agent is running (PID ${status.pid})`);
      passed++;
    } else {
      info("Agent is not running (run kassar start)");
    }

    section("Summary");
    console.log(
      `  \x1b[32m${passed} passed\x1b[0m  \x1b[31m${failed} failed\x1b[0m`,
    );
    console.log();

    if (failed > 0) {
      process.exit(1);
    }
  });

program
  .command("logs")
  .description("Print the last lines from the agent log file")
  .option("-n, --lines <number>", "Number of lines to show", "50")
  .option("-f, --follow", "Stream new log lines as they arrive")
  .action((opts: { lines: string; follow?: boolean }) => {
    logger.info("CLI: kassar logs");
    const lineCount = parseInt(opts.lines, 10) || 50;

    if (!existsSync(APP_LOG)) {
      fail(`Log file not found: ${APP_LOG}`);
      info("The agent may not have run yet. Try kassar start.");
      process.exit(1);
    }

    if (opts.follow) {
      info(`Streaming ${APP_LOG} (Ctrl+C to stop)\n`);
      const tail = spawnProc("tail", ["-f", "-n", String(lineCount), APP_LOG], {
        stdio: "inherit",
      });
      tail.on("error", (err) => {
        fail(`Failed to follow log: ${err.message}`);
        process.exit(1);
      });
      return;
    }

    const raw = readFileSync(APP_LOG, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-lineCount);

    section(`Last ${tail.length} log line(s) from ${APP_LOG}`);
    for (const line of tail) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const ts = parsed["timestamp"] as string | undefined;
        const level = ((parsed["level"] as string) || "info").toUpperCase().padEnd(5);
        const msg = parsed["message"] as string | undefined;
        const levelColor =
          level.startsWith("ERROR")
            ? "\x1b[31m"
            : level.startsWith("WARN")
              ? "\x1b[33m"
              : level.startsWith("INFO")
                ? "\x1b[36m"
                : "\x1b[0m";
        console.log(
          `  \x1b[90m${ts || ""}\x1b[0m ${levelColor}${level}\x1b[0m ${msg || line}`,
        );
      } catch {
        console.log(`  ${line}`);
      }
    }
    console.log();
  });

const configCmd = program
  .command("config")
  .description("Read or write values in config.json");

configCmd
  .command("get [key]")
  .description(
    "Get a config value by dot-notation key (e.g. agent.name). Omit key to print all.",
  )
  .action((key: string | undefined) => {
    logger.info(`CLI: kassar config get ${key ?? "(all)"}`);
    const cfg = loadConfig();

    if (!key) {
      section("config.json");
      console.log(JSON.stringify(cfg, null, 2));
      return;
    }

    const value = getNestedValue(
      cfg as unknown as Record<string, unknown>,
      key,
    );

    if (value === undefined) {
      fail(`Key not found: ${key}`);
      process.exit(1);
    }

    if (typeof value === "object") {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(String(value));
    }
  });

configCmd
  .command("set <key> <value>")
  .description(
    "Set a config value by dot-notation key (e.g. logging.level debug).",
  )
  .action((key: string, rawValue: string) => {
    logger.info(`CLI: kassar config set ${key} = ${rawValue}`);

    const cfg = loadConfig();
    const cfgObj = cfg as unknown as Record<string, unknown>;

    const existing = getNestedValue(cfgObj, key);

    let coerced: unknown = rawValue;
    if (typeof existing === "number") {
      const n = Number(rawValue);
      if (!isNaN(n)) coerced = n;
    } else if (typeof existing === "boolean") {
      coerced = rawValue === "true" || rawValue === "1";
    }

    setNestedValue(cfgObj, key, coerced);
    writeConfig(cfgObj as unknown as AgentConfig);
    ok(`Set ${key} = ${JSON.stringify(coerced)}`);
    logger.info(`Config updated: ${key} = ${JSON.stringify(coerced)}`);
  });

const telegramCmd = program
  .command("telegram")
  .description("Manage Telegram integration");

telegramCmd
  .command("connect")
  .description("Interactively set and save your Telegram bot token")
  .action(async () => {
    logger.info("CLI: kassar telegram connect");
    section("Telegram Bot Setup");

    const cfg = loadConfig();
    const existing = cfg.telegram.botToken;
    if (existing) {
      const masked =
        existing.length > 8
          ? existing.slice(0, 4) + "****" + existing.slice(-4)
          : "****";
      info(`Current token: ${masked}`);
    }

    console.log(
      "  You can get a token from \x1b[4mhttps://t.me/BotFather\x1b[0m\n",
    );

    const token = await prompt("  Enter BOT_TOKEN: ", true);

    if (!token) {
      fail("No token entered. Aborted.");
      process.exit(1);
    }

    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      fail(
        "Token format looks wrong. Expected format: 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      );
      process.exit(1);
    }

    const cfgObj = cfg as unknown as Record<string, unknown>;
    setNestedValue(cfgObj, "telegram.botToken", token);
    writeConfig(cfgObj as unknown as AgentConfig);

    ok("Telegram bot token saved to config.json");
    logger.info("Telegram bot token updated via CLI");

    info("Run \x1b[1mkassar doctor\x1b[0m to verify your setup.");
    console.log();
  });

async function runForcedTest(): Promise<void> {
  const { boot } = await import("../src/core/gateway.js");
  const { eventBus } = await import("../src/core/event-bus.js");
  const type = await import("../src/core/types.js");
  void type;

  type AgentResponse = import("../src/core/types.js").AgentResponse;

  const TEST_MESSAGES = [
    "run echo hello",
    "read file test.txt",
  ];

  section("Forced Gateway Test");
  info(`Booting gateway and sending ${TEST_MESSAGES.length} message(s)...\n`);
  logger.info("Forced test started");

  const gw = await boot();

  const responseMap = new Map<string, AgentResponse>();

  eventBus.onResponse((r) => {
    responseMap.set(r.messageId, r);
  });

  const msgIds: string[] = [];
  for (const content of TEST_MESSAGES) {
    const msgId = await gw.submit(content, { source: "forced-test", role: "user" });
    msgIds.push(msgId);
    logger.info(`Forced test: submitted message ${msgId} → "${content}"`);
  }

  const deadline = Date.now() + 5000;
  while (msgIds.some((id) => !responseMap.has(id)) && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 50));
  }

  const timedOut = msgIds.filter((id) => !responseMap.has(id));
  if (timedOut.length > 0) {
    fail(`Timed out waiting for ${timedOut.length} response(s)`);
  }

  const responses = msgIds.map((id) => responseMap.get(id));

  console.log("\n\x1b[1m━━━ Test Results ━━━\x1b[0m\n");

  for (let i = 0; i < TEST_MESSAGES.length; i++) {
    const input = TEST_MESSAGES[i]!;
    const resp = responses[i];

    console.log(`  \x1b[36m▶ gateway.receive("${input}")\x1b[0m`);

    if (resp) {
      const routeColor =
        resp.route === "tool"
          ? "\x1b[33m"
          : resp.route === "memory"
            ? "\x1b[35m"
            : resp.route === "model"
              ? "\x1b[32m"
              : "\x1b[90m";

      console.log(`    ${routeColor}route   :\x1b[0m ${resp.route}`);
      console.log(`    \x1b[90mresponse:\x1b[0m ${resp.content.slice(0, 120)}`);
      console.log(`    \x1b[90msuccess :\x1b[0m ${resp.success ? "\x1b[32mtrue\x1b[0m" : "\x1b[31mfalse\x1b[0m"}`);
      console.log(`    \x1b[90mtime    :\x1b[0m ${resp.durationMs}ms`);
      if (resp.error) {
        console.log(`    \x1b[31merror   :\x1b[0m ${resp.error}`);
      }
    } else {
      fail("  No response received");
    }

    console.log();
  }

  const allPassed = responses.length === TEST_MESSAGES.length && responses.every((r) => r?.success);
  console.log(
    `\x1b[1mResult: ${allPassed ? "\x1b[32mALL PASSED ✔" : "\x1b[31mSOME FAILED ✘"}\x1b[0m`,
  );
  console.log(`Responses: ${responses.length}/${TEST_MESSAGES.length}\n`);

  logger.info(`Forced test complete: ${responses.length}/${TEST_MESSAGES.length} responses received`);

  await gw.stop();
  process.exit(allPassed ? 0 : 1);
}

program
  .command("dashboard")
  .description("Open the kassar-agent dashboard in your browser (serves locally on port 22022)")
  .option("--port <port>",    "Port to serve dashboard on", "22022")
  .option("--no-open",        "Start server without opening the browser")
  .action(async (opts: { port: string; open: boolean }) => {
    logger.info("CLI: kassar dashboard");
    const port = parseInt(opts.port, 10) || 22022;

    const { DashboardServer } = await import("../src/services/dashboardServer.js");
    const server = new DashboardServer({ port, autoOpen: opts.open !== false });

    if (!DashboardServer.isBuilt()) {
      fail(
        "Dashboard build not found.\n" +
        "  Run: pnpm --filter @workspace/kassar-dashboard build\n" +
        "  Then copy dist/ to dashboard-dist/ in the project root."
      );
      process.exit(1);
    }

    try {
      await server.start();
      ok(`Dashboard running at http://127.0.0.1:${port}`);
      info("Press Ctrl+C to stop.");

      process.on("SIGINT",  () => { server.stop(); process.exit(0); });
      process.on("SIGTERM", () => { server.stop(); process.exit(0); });

      // Keep process alive
      await new Promise(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      process.exit(1);
    }
  });

const serviceCmd = program
  .command("service")
  .description("Manage kassar-agent as a Windows Service (Windows only)");

serviceCmd
  .command("install")
  .description("Install kassar-agent as a Windows service")
  .option("--name <name>",        "Service name",         defaultServiceConfig.serviceName)
  .option("--display <display>",  "Display name",         defaultServiceConfig.displayName)
  .option("--no-autostart",       "Disable auto-start on boot")
  .action((opts: { name?: string; display?: string; autostart: boolean }) => {
    logger.info("CLI: kassar service install");
    section("Windows Service — Install");
    const serviceName = opts.name    ?? defaultServiceConfig.serviceName;
    const displayName = opts.display ?? defaultServiceConfig.displayName;
    try {
      installService({
        ...defaultServiceConfig,
        serviceName,
        displayName,
        autoStart: opts.autostart !== false,
      });
      ok(`Service "${serviceName}" installed successfully`);
      info(`Auto-start on boot: ${opts.autostart !== false ? "yes" : "no"}`);
      info(`Run: kassar service start`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      logger.error(`[SERVICE] install error — ${msg}`);
      process.exit(1);
    }
  });

serviceCmd
  .command("uninstall")
  .description("Uninstall the kassar-agent Windows service")
  .option("--name <name>", "Service name", defaultServiceConfig.serviceName)
  .action((opts: { name: string }) => {
    logger.info("CLI: kassar service uninstall");
    section("Windows Service — Uninstall");
    try {
      uninstallService({ ...defaultServiceConfig, serviceName: opts.name });
      ok(`Service "${opts.name}" uninstalled successfully`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      logger.error(`[SERVICE] uninstall error — ${msg}`);
      process.exit(1);
    }
  });

serviceCmd
  .command("start")
  .description("Start the kassar-agent Windows service")
  .option("--name <name>", "Service name", defaultServiceConfig.serviceName)
  .action((opts: { name: string }) => {
    logger.info("CLI: kassar service start");
    section("Windows Service — Start");
    try {
      startService({ ...defaultServiceConfig, serviceName: opts.name });
      ok(`Service "${opts.name}" started`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      logger.error(`[SERVICE] start error — ${msg}`);
      process.exit(1);
    }
  });

serviceCmd
  .command("stop")
  .description("Stop the kassar-agent Windows service")
  .option("--name <name>", "Service name", defaultServiceConfig.serviceName)
  .action((opts: { name: string }) => {
    logger.info("CLI: kassar service stop");
    section("Windows Service — Stop");
    try {
      stopService({ ...defaultServiceConfig, serviceName: opts.name });
      ok(`Service "${opts.name}" stopped`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      logger.error(`[SERVICE] stop error — ${msg}`);
      process.exit(1);
    }
  });

serviceCmd
  .command("restart")
  .description("Restart the kassar-agent Windows service")
  .option("--name <name>", "Service name", defaultServiceConfig.serviceName)
  .action((opts: { name: string }) => {
    logger.info("CLI: kassar service restart");
    section("Windows Service — Restart");
    try {
      restartService({ ...defaultServiceConfig, serviceName: opts.name });
      ok(`Service "${opts.name}" restarted`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(msg);
      logger.error(`[SERVICE] restart error — ${msg}`);
      process.exit(1);
    }
  });

serviceCmd
  .command("status")
  .description("Check the status of the kassar-agent Windows service")
  .option("--name <name>", "Service name", defaultServiceConfig.serviceName)
  .action((opts: { name: string }) => {
    logger.info("CLI: kassar service status");
    section("Windows Service — Status");

    const status = getServiceStatus({ ...defaultServiceConfig, serviceName: opts.name });

    if (status.error) {
      info(`Platform note: ${status.error}`);
    }

    console.log(`  Service name : ${opts.name}`);
    console.log(`  Installed    : ${status.installed ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
    console.log(`  Running      : ${status.running   ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
    console.log(`  Auto-start   : ${status.autoStart ? "\x1b[32myes\x1b[0m" : "\x1b[33mno\x1b[0m"}`);
    if (status.state)     console.log(`  State        : ${status.state}`);
    if (status.startType) console.log(`  Start type   : ${status.startType}`);
    console.log();

    process.exit(status.running ? 0 : 1);
  });

program.parse(process.argv);
