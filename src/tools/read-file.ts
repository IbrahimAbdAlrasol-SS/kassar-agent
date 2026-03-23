import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { BaseTool, type ToolResult, type ToolSchema } from "./base-tool.js";
import { config } from "../config/index.js";

export class ReadFileTool extends BaseTool {
  readonly name = "read_file";
  readonly description = "Read a file from the project workspace";
  readonly risk_level = "LOW" as const;
  readonly schema: ToolSchema = {
    name: "read_file",
    description: this.description,
    input: {
      path: { type: "string", description: "Relative path inside the workspace", required: true },
    },
    risk_level: "LOW",
  };

  protected async run(input: Record<string, unknown>): Promise<ToolResult> {
    const rawPath = String(input["path"] ?? "").trim();

    if (!rawPath) {
      return { success: false, output: "", error: "No path provided" };
    }

    const workspaceRoot = path.resolve(config.workspace.dir);
    const target = path.resolve(workspaceRoot, rawPath);

    if (!target.startsWith(workspaceRoot + path.sep) && target !== workspaceRoot) {
      return {
        success: false,
        output: "",
        error: `Access denied: path is outside workspace (${config.workspace.dir})`,
      };
    }

    if (!existsSync(target)) {
      return { success: false, output: "", error: `File not found: ${rawPath}` };
    }

    const content = await readFile(target, "utf-8");

    return {
      success: true,
      output: content,
      data: { path: target, size: content.length },
    };
  }
}
