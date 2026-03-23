import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { BaseTool, type ToolResult, type ToolSchema } from "./base-tool.js";
import { config } from "../config/index.js";

export class WriteFileTool extends BaseTool {
  readonly name = "write_file";
  readonly description = "Write content to a file inside the project workspace";
  readonly risk_level = "MEDIUM" as const;
  readonly schema: ToolSchema = {
    name: "write_file",
    description: this.description,
    input: {
      path: { type: "string", description: "Relative path inside the workspace", required: true },
      content: { type: "string", description: "Content to write", required: true },
    },
    risk_level: "MEDIUM",
  };

  protected async run(input: Record<string, unknown>): Promise<ToolResult> {
    const rawPath = String(input["path"] ?? "").trim();
    const content = String(input["content"] ?? "");

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

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf-8");

    return {
      success: true,
      output: `Written ${content.length} bytes to ${rawPath}`,
      data: { path: target, size: content.length },
    };
  }
}
