export interface UserMemory {
  preferred_name:    string;
  preferred_language: string;
  response_style:    "concise" | "detailed";
  allowed_tools:     string[];
  forbidden_actions: string[];
  notes:             string[];
  updated_at:        number;
}

export interface ProjectMemory {
  project_name:            string;
  stack:                   string[];
  architecture_decisions:  string[];
  important_paths:         string[];
  rejected_approaches:     string[];
  open_tasks:              string[];
  notes:                   string[];
  updated_at:              number;
}

export interface SessionEntry {
  timestamp:         number;
  user_input:        string;
  classified_intent: string;
  action_taken:      string;
  result_summary:    string;
}

export type RulesMemory = Record<string, unknown>;

export interface MemoryContext {
  user:     UserMemory;
  sessions: SessionEntry[];
  rules:    RulesMemory;
}

export const DEFAULT_USER_MEMORY: UserMemory = {
  preferred_name:    "",
  preferred_language: "ar",
  response_style:    "concise",
  allowed_tools:     [],
  forbidden_actions: [],
  notes:             [],
  updated_at:        0,
};

export const DEFAULT_PROJECT_MEMORY: ProjectMemory = {
  project_name:           "",
  stack:                  [],
  architecture_decisions: [],
  important_paths:        [],
  rejected_approaches:    [],
  open_tasks:             [],
  notes:                  [],
  updated_at:             0,
};
