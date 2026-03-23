import { logger } from "../utils/logger.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ToolSchema {
  name: string;
  description: string;
  input: Record<string, { type: string; description: string; required?: boolean }>;
  risk_level: RiskLevel;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly risk_level: RiskLevel;
  abstract readonly schema: ToolSchema;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    logger.info(`[TOOL] ${this.name}=${JSON.stringify(input)}`);
    const start = Date.now();

    try {
      const result = await this.run(input);
      const elapsed = Date.now() - start;
      logger.info(`[RESULT] ${this.name} completed in ${elapsed}ms → ${String(result.output).slice(0, 120)}`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[RESULT] ${this.name} failed in ${elapsed}ms — ${message}`);
      return { success: false, output: "", error: message };
    }
  }

  protected abstract run(input: Record<string, unknown>): Promise<ToolResult>;
}
