import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import {
  readJson,
  writeJson,
  appendJsonArray,
  readJsonArray,
  ensureDir,
} from "./store.js";
import type {
  UserMemory,
  ProjectMemory,
  SessionEntry,
  RulesMemory,
  MemoryContext,
} from "./types.js";
import {
  DEFAULT_USER_MEMORY,
  DEFAULT_PROJECT_MEMORY,
} from "./types.js";
import type { Classification } from "./classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_ROOT = path.resolve(__dirname, "../../../memory");

const PATHS = {
  user:        () => path.join(MEMORY_ROOT, "user.json"),
  activeProj:  () => path.join(MEMORY_ROOT, "active_project.json"),
  projects:    (name: string) =>
    path.join(MEMORY_ROOT, "projects", `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`),
  sessions:    () => path.join(MEMORY_ROOT, "sessions", "sessions.json"),
  rules:       () => path.join(MEMORY_ROOT, "rules", "rules.json"),
};

const MEM = (msg: string) => logger.info(`[MEMORY] ${msg}`);

class MemoryManager {
  private _activeProject: string | null = null;

  constructor() {
    this.initDirs();
    this._activeProject = readJson<{ name: string } | null>(PATHS.activeProj(), null)?.name ?? null;
  }

  private initDirs(): void {
    ensureDir(MEMORY_ROOT);
    ensureDir(path.join(MEMORY_ROOT, "projects"));
    ensureDir(path.join(MEMORY_ROOT, "sessions"));
    ensureDir(path.join(MEMORY_ROOT, "rules"));
  }

  // ── User memory ─────────────────────────────────────────────────────────
  getUserMemory(): UserMemory {
    const mem = readJson<UserMemory>(PATHS.user(), { ...DEFAULT_USER_MEMORY });
    return { ...DEFAULT_USER_MEMORY, ...mem };
  }

  updateUserMemory(patch: Partial<UserMemory>): void {
    const current = this.getUserMemory();
    const updated  = { ...current, ...patch, updated_at: Date.now() };
    writeJson(PATHS.user(), updated);
    MEM(`updated user memory  keys=${Object.keys(patch).join(",")}`);
  }

  // ── Rules memory ─────────────────────────────────────────────────────────
  saveRule(ruleKey: string, value: string): void {
    const rules = this.getRules();
    rules[ruleKey] = value;
    writeJson(PATHS.rules(), rules);
    MEM(`saved rule  key=${ruleKey}`);
  }

  saveNamedRule(label: string, value: string): void {
    const key = label
      .trim()
      .slice(0, 40)
      .replace(/\s+/g, "_");
    this.saveRule(key, value);
  }

  getRules(): RulesMemory {
    return readJson<RulesMemory>(PATHS.rules(), {});
  }

  // ── Project memory ───────────────────────────────────────────────────────
  get activeProject(): string | null {
    return this._activeProject;
  }

  setActiveProject(name: string): void {
    this._activeProject = name;
    writeJson(PATHS.activeProj(), { name });
    MEM(`active project set to: ${name}`);
  }

  getProjectMemory(projectName: string): ProjectMemory {
    const mem = readJson<ProjectMemory>(PATHS.projects(projectName), {
      ...DEFAULT_PROJECT_MEMORY,
      project_name: projectName,
    });
    return { ...DEFAULT_PROJECT_MEMORY, project_name: projectName, ...mem };
  }

  getActiveProjectMemory(): ProjectMemory | null {
    if (!this._activeProject) return null;
    return this.getProjectMemory(this._activeProject);
  }

  updateProjectMemory(projectName: string, patch: Partial<ProjectMemory>): void {
    const current = this.getProjectMemory(projectName);
    const updated  = { ...current, ...patch, updated_at: Date.now() };
    writeJson(PATHS.projects(projectName), updated);
    MEM(`updated project memory  project=${projectName}  keys=${Object.keys(patch).join(",")}`);
  }

  // ── Session memory ───────────────────────────────────────────────────────
  appendSessionEntry(entry: Omit<SessionEntry, "timestamp">): void {
    const full: SessionEntry = { timestamp: Date.now(), ...entry };
    appendJsonArray<SessionEntry>(PATHS.sessions(), full, 100);
    MEM(`appended session  intent=${entry.classified_intent}  action=${entry.action_taken}`);
  }

  getRecentSessionEntries(limit = 10): SessionEntry[] {
    const all = readJsonArray<SessionEntry>(PATHS.sessions());
    return all.slice(-limit);
  }

  // ── Classified save ──────────────────────────────────────────────────────
  saveClassified(cl: Classification, projectName?: string): string {
    const { category, subtype, value } = cl;

    if (category === "USER") {
      return this._applyUserClassification(subtype, value);
    }

    if (category === "RULE") {
      const label = cl.label ?? value;
      this.saveNamedRule(label, value);
      if (subtype === "forbidden") return `مفهوم، مش هعمل كده: "${value}"`;
      if (subtype === "ask_before") return `تمام، هسألك قبل ما أعمل: "${value}"`;
      return `تمام، من الآن: "${value}"`;
    }

    if (category === "PROJECT") {
      const proj = projectName ?? this._activeProject ?? "default";
      if (proj !== this._activeProject) this.setActiveProject(proj);
      const current = this.getProjectMemory(proj);
      return this._applyProjectClassification(proj, subtype, value, current);
    }

    return `تمام، اتذكّرت.`;
  }

  private _applyUserClassification(subtype: string, value: string): string {
    switch (subtype) {
      case "preferred_name":
        this.updateUserMemory({ preferred_name: value });
        return `تمام، هحضرك بـ "${value}" من الآن.`;
      case "note":
        {
          const mem = this.getUserMemory();
          this.updateUserMemory({ notes: [...mem.notes.slice(-9), value] });
          return `تمام، اتذكّرت: "${value}"`;
        }
      case "response_style_concise":
        this.updateUserMemory({ response_style: "concise" });
        return "تمام، هرد بشكل موجز من الآن.";
      case "response_style_detailed":
        this.updateUserMemory({ response_style: "detailed" });
        return "تمام، هرد بشكل مفصّل من الآن.";
      case "response_style_pref":
        {
          const style: "concise" | "detailed" =
            /موجز|مختصر|قصير/u.test(value) ? "concise" : "detailed";
          this.updateUserMemory({ response_style: style });
          return style === "concise"
            ? "تمام، هرد بشكل موجز من الآن."
            : "تمام، هرد بشكل مفصّل من الآن.";
        }
      case "preferred_language":
        this.updateUserMemory({ preferred_language: value });
        return `تمام، هتكلم معك بـ "${value}" من الآن.`;
      default:
        {
          const mem2 = this.getUserMemory();
          this.updateUserMemory({ notes: [...mem2.notes.slice(-9), value] });
          return `تمام، اتذكّرت.`;
        }
    }
  }

  private _applyProjectClassification(
    proj: string,
    subtype: string,
    value: string,
    current: ProjectMemory,
  ): string {
    switch (subtype) {
      case "stack":
        {
          const parts = value.split(/[,،\s]+/).filter(Boolean);
          this.updateProjectMemory(proj, { stack: [...new Set([...current.stack, ...parts])] });
          return `تمام، حفظت Stack المشروع: ${parts.join(", ")}`;
        }
      case "architecture_decision":
        this.updateProjectMemory(proj, {
          architecture_decisions: [...current.architecture_decisions.slice(-9), value],
        });
        return `تمام، حفظت القرار: "${value}"`;
      case "important_path":
        this.updateProjectMemory(proj, {
          important_paths: [...current.important_paths.slice(-9), value],
        });
        return `تمام، حفظت المسار: ${value}`;
      case "open_task":
        this.updateProjectMemory(proj, {
          open_tasks: [...current.open_tasks.slice(-9), value],
        });
        return `تمام، أضفت المهمة: "${value}"`;
      case "rejected_approach":
        this.updateProjectMemory(proj, {
          rejected_approaches: [...current.rejected_approaches.slice(-9), value],
        });
        return `تمام، سجّلت الفكرة المرفوضة.`;
      default:
        this.updateProjectMemory(proj, {
          notes: [...current.notes.slice(-9), value],
        });
        return `تمام، حفظت للمشروع: "${value}"`;
    }
  }

  // ── Context for model ────────────────────────────────────────────────────
  getMemoryContext(sessionLimit = 8): MemoryContext {
    return {
      user:     this.getUserMemory(),
      sessions: this.getRecentSessionEntries(sessionLimit),
      rules:    this.getRules(),
    };
  }
}

export const memoryManager = new MemoryManager();
