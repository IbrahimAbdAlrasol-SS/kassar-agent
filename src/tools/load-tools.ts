import { toolRegistry } from "./tool-registry.js";
import { RunTerminalTool } from "./run-terminal.js";
import { ReadFileTool } from "./read-file.js";
import { WriteFileTool } from "./write-file.js";
import { OpenAppTool } from "./open-app.js";
import { SearchWebTool } from "./search-web.js";
import { logger } from "../utils/logger.js";

export function loadTools(): void {
  const tools = [
    new RunTerminalTool(),
    new ReadFileTool(),
    new WriteFileTool(),
    new OpenAppTool(),
    new SearchWebTool(),
  ];

  for (const tool of tools) {
    toolRegistry.register(tool);
  }

  logger.info(
    `Tools loaded: [${tools.map((t) => `${t.name}(${t.risk_level})`).join(", ")}]`,
  );
}
