export type MessageRole = "user" | "system" | "assistant" | "tool";

export type AgentRoute = "tool" | "memory" | "model" | "passthrough";

export interface ToolCallRequest {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  source: string;
  toolCall?: ToolCallRequest;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  id: string;
  messageId: string;
  content: string;
  route: AgentRoute;
  success: boolean;
  error?: string;
  toolName?: string;
  toolData?: unknown;
  source: string;
  timestamp: number;
  durationMs: number;
}

export interface ModelRequest {
  messageId:     string;
  content:       string;
  history:       AgentMessage[];
  metadata?:     Record<string, unknown>;
  memoryContext?: import("../memory/types.js").MemoryContext;
}

export interface ModelResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}
