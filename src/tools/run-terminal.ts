import { exec } from "child_process";
import { promisify } from "util";
import { BaseTool, type ToolResult, type ToolSchema } from "./base-tool.js";

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /rmdir\s+\/s/i,
  /shutdown/i,
  /halt\b/i,
  /reboot\b/i,
  /format\s+[a-z]:/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\/(sda|hda|nvme)/i,
  /sudo\s+rm/i,
  /chmod\s+-R\s+777\s+\//i,
];

export class RunTerminalTool extends BaseTool {
  readonly name = "run_terminal";
  readonly description = "Execute a shell command safely and return stdout/stderr";
  readonly risk_level = "HIGH" as const;
  readonly schema: ToolSchema = {
    name: "run_terminal",
    description: this.description,
    input: {
      command: { type: "string", description: "Shell command to run", required: true },
    },
    risk_level: "HIGH",
  };

  protected async run(input: Record<string, unknown>): Promise<ToolResult> {
    const command = String(input["command"] ?? "").trim();

    if (!command) {
      return { success: false, output: "", error: "No command provided" };
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          success: false,
          output: "",
          error: `Blocked: command matches dangerous pattern (${pattern.source})`,
        };
      }
    }

    const { stdout, stderr } = await execAsync(command, {
      timeout: 10_000,
      maxBuffer: 1024 * 256,
      env: { ...process.env, PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    });

    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

    return {
      success: true,
      output: output || "(no output)",
      data: { stdout: stdout.trim(), stderr: stderr.trim() },
    };
  }
}
