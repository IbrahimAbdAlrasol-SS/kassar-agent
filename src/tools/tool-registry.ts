import { logger } from "../utils/logger.js";
import type { BaseTool, ToolResult, ToolSchema, RiskLevel } from "./base-tool.js";

export interface ToolInfo {
  name: string;
  description: string;
  risk_level: RiskLevel;
  schema: ToolSchema;
}

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  register(tool: BaseTool): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool already registered, overwriting: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    logger.info(`Tool registered: ${tool.name}  risk=${tool.risk_level}`);
  }

  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) logger.info(`Tool unregistered: ${name}`);
    return removed;
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async invoke(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: "", error: `Tool not found: ${name}` };
    }
    return tool.execute(input);
  }

  list(): ToolInfo[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      risk_level: t.risk_level,
      schema: t.schema,
    }));
  }

  count(): number {
    return this.tools.size;
  }
}

export const toolRegistry = new ToolRegistry();
