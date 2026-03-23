import { exec } from "child_process";
import { promisify } from "util";
import { BaseTool, type ToolResult, type ToolSchema } from "./base-tool.js";

const execAsync = promisify(exec);

const ALLOWED_APPS: Record<string, string> = {
  notepad: "notepad.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  gedit: "gedit",
  nano: "nano",
  vim: "vim",
  code: "code",
  xterm: "xterm",
};

export class OpenAppTool extends BaseTool {
  readonly name = "open_app";
  readonly description = "Open an allowed application using OS commands";
  readonly risk_level = "MEDIUM" as const;
  readonly schema: ToolSchema = {
    name: "open_app",
    description: this.description,
    input: {
      app: {
        type: "string",
        description: `Application name. Allowed: ${Object.keys(ALLOWED_APPS).join(", ")}`,
        required: true,
      },
    },
    risk_level: "MEDIUM",
  };

  protected async run(input: Record<string, unknown>): Promise<ToolResult> {
    const appName = String(input["app"] ?? "").trim().toLowerCase();

    if (!appName) {
      return { success: false, output: "", error: "No app name provided" };
    }

    const command = ALLOWED_APPS[appName];
    if (!command) {
      return {
        success: false,
        output: "",
        error: `App "${appName}" is not in the allowed list. Allowed: ${Object.keys(ALLOWED_APPS).join(", ")}`,
      };
    }

    const platform = process.platform;
    let launchCmd: string;

    if (platform === "win32") {
      launchCmd = `start "" "${command}"`;
    } else if (platform === "darwin") {
      launchCmd = `open -a "${command}"`;
    } else {
      launchCmd = `${command} &`;
    }

    await execAsync(launchCmd, { timeout: 5_000 });

    return {
      success: true,
      output: `Launched ${appName} (${command}) on ${platform}`,
    };
  }
}
