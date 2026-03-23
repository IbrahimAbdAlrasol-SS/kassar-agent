import { logger } from "../utils/logger.js";
import type { UserMemory, RulesMemory, ProjectMemory, SessionEntry, MemoryContext } from "./types.js";

export type RecallTarget = "user" | "rules" | "project" | "sessions";

export interface RecallQuery {
  target:      RecallTarget;
  projectName?: string;
}

const MEM = (msg: string) => logger.info(`[MEMORY] ${msg}`);

// ─── Detect recall queries ──────────────────────────────────────────────────
const RECALL_USER: RegExp[] = [
  /ماذا\s+تتذكر\s+(عني|عن\s+بياناتي)/u,
  /ما\s+الذي\s+(?:حفظته|تعرفه)\s+عني/u,
  /ماذا\s+تعرف\s+عني/u,
  /ما\s+(?:معلوماتي|بياناتي)\s+(?:عندك|لديك)/u,
  /what\s+do\s+you\s+(know|remember)\s+about\s+me/i,
  /show\s+my\s+(profile|info|data)/i,
];

const RECALL_RULES: RegExp[] = [
  /ما\s+القواعد\s+(?:التي\s+)?(?:عندك|لديك)/u,
  /اعرض\s+(?:لي\s+)?القواعد/u,
  /ما\s+هي\s+القواعد/u,
  /قواعدك/u,
  /what\s+(?:are\s+(?:your\s+)?)?(?:the\s+)?rules/i,
  /show\s+(?:me\s+(?:the\s+)?)?rules/i,
];

const RECALL_SESSIONS: RegExp[] = [
  /ماذا\s+(?:فعلنا|عملنا)\s+(?:اليوم|مؤخراً?)/u,
  /ما\s+آخر\s+(?:الأنشطة|الأعمال)/u,
  /سجل\s+الجلسات/u,
  /show\s+(?:recent\s+)?sessions/i,
  /what\s+(?:did\s+we\s+do|have\s+we\s+done)\s+(?:today|recently)/i,
];

const RECALL_PROJECT: RegExp[] = [
  /ما\s+الذي\s+تتذكره\s+عن\s+(?:هذا\s+)?المشروع/u,
  /ما\s+قرارات\s+المشروع/u,
  /ذاكرة\s+المشروع/u,
  /اعرض\s+(?:لي\s+)?(?:بيانات|تفاصيل)\s+المشروع/u,
  /what\s+do\s+you\s+(?:know|remember)\s+about\s+(?:the\s+)?project/i,
  /show\s+project\s+(?:info|memory|data)/i,
];

export function detectRecallQuery(text: string): RecallQuery | null {
  const t = text.trim();

  for (const pat of RECALL_USER) {
    if (pat.test(t)) {
      MEM("recall applied  target=user");
      return { target: "user" };
    }
  }
  for (const pat of RECALL_RULES) {
    if (pat.test(t)) {
      MEM("recall applied  target=rules");
      return { target: "rules" };
    }
  }
  for (const pat of RECALL_SESSIONS) {
    if (pat.test(t)) {
      MEM("recall applied  target=sessions");
      return { target: "sessions" };
    }
  }
  for (const pat of RECALL_PROJECT) {
    if (pat.test(t)) {
      MEM("recall applied  target=project");
      return { target: "project" };
    }
  }
  return null;
}

// ─── Formatters ─────────────────────────────────────────────────────────────
export function formatUserMemory(mem: UserMemory): string {
  const lines: string[] = ["ما أتذكره عنك:"];
  if (mem.preferred_name) lines.push(`• الاسم: ${mem.preferred_name}`);
  lines.push(`• اللغة المفضلة: ${mem.preferred_language || "عربي"}`);
  lines.push(`• أسلوب الرد: ${mem.response_style === "detailed" ? "مفصّل" : "موجز"}`);
  if (mem.notes.length > 0) {
    lines.push("• ملاحظات:");
    for (const n of mem.notes.slice(-5)) lines.push(`  - ${n}`);
  }
  if (mem.forbidden_actions.length > 0) {
    lines.push("• ما طلبتَ مني تجنبه:");
    for (const f of mem.forbidden_actions.slice(-5)) lines.push(`  - ${f}`);
  }
  return lines.join("\n");
}

export function formatRules(rules: RulesMemory): string {
  const keys = Object.keys(rules);
  if (keys.length === 0) return "لا توجد قواعد مخزّنة حتى الآن.";
  const lines = ["القواعد المخزّنة:"];
  for (const k of keys) {
    lines.push(`• ${String(rules[k])}`);
  }
  return lines.join("\n");
}

export function formatProjectMemory(proj: ProjectMemory): string {
  if (!proj.project_name && proj.stack.length === 0) {
    return "لا توجد بيانات مشروع مخزّنة.";
  }
  const lines = [`ذاكرة المشروع (${proj.project_name || "بدون اسم"}):`];
  if (proj.stack.length > 0) lines.push(`• Stack: ${proj.stack.join(", ")}`);
  if (proj.architecture_decisions.length > 0) {
    lines.push("• قرارات معمارية:");
    for (const d of proj.architecture_decisions.slice(-3)) lines.push(`  - ${d}`);
  }
  if (proj.important_paths.length > 0) {
    lines.push("• مسارات مهمة:");
    for (const p of proj.important_paths.slice(-3)) lines.push(`  - ${p}`);
  }
  if (proj.rejected_approaches.length > 0) {
    lines.push("• أفكار مرفوضة:");
    for (const r of proj.rejected_approaches.slice(-3)) lines.push(`  - ${r}`);
  }
  if (proj.open_tasks.length > 0) {
    lines.push("• مهام مفتوحة:");
    for (const t of proj.open_tasks.slice(-3)) lines.push(`  - ${t}`);
  }
  if (proj.notes.length > 0) {
    lines.push("• ملاحظات:");
    for (const n of proj.notes.slice(-3)) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

export function formatSessions(sessions: SessionEntry[]): string {
  if (sessions.length === 0) return "لا توجد جلسات مخزّنة بعد.";
  const lines = [`آخر ${sessions.length} نشاط:`];
  for (const s of sessions.slice(-8)) {
    const d = new Date(s.timestamp).toLocaleString("ar-EG", {
      dateStyle: "short",
      timeStyle: "short",
    });
    lines.push(`• [${d}] ${s.result_summary.slice(0, 80)}`);
  }
  return lines.join("\n");
}

// ─── Smart context for model injection ──────────────────────────────────────
const TECH_KEYWORDS =
  /\b(ملف|كود|مشروع|سيرفر|server|api|database|git|python|javascript|typescript|node|react|bash|terminal|أمر|docker|بايثون|جافا|npm|pnpm|تثبيت|install|deploy|خطأ|error|bug)\b/iu;

export function buildSmartContext(
  userMessage: string,
  ctx: MemoryContext,
  projectMemory?: ProjectMemory | null,
): string {
  const lines: string[] = ["## سياق الذاكرة"];
  const { user, sessions, rules } = ctx;
  const isTechnical = TECH_KEYWORDS.test(userMessage);

  // ── Always: user profile (concise) ──
  const name = user.preferred_name || "";
  const lang = user.preferred_language || "ar";
  const style = user.response_style || "concise";
  lines.push(`المستخدم: ${name || "غير محدد"} | لغة: ${lang} | أسلوب: ${style === "detailed" ? "مفصّل" : "موجز"}`);

  // ── Rules (always inject if present) ──
  const ruleKeys = Object.keys(rules);
  if (ruleKeys.length > 0) {
    lines.push("القواعد الملزمة:");
    for (const k of ruleKeys.slice(0, 6)) {
      lines.push(`  - ${String(rules[k])}`);
    }
  }

  // ── Forbidden actions ──
  if (user.forbidden_actions.length > 0) {
    lines.push(`محظور: ${user.forbidden_actions.slice(-4).join(" | ")}`);
  }

  // ── Project memory (only when technical) ──
  if (isTechnical && projectMemory && projectMemory.stack.length > 0) {
    lines.push(`المشروع: ${projectMemory.project_name || "—"} | Stack: ${projectMemory.stack.join(", ")}`);
    if (projectMemory.architecture_decisions.length > 0) {
      lines.push(`قرارات: ${projectMemory.architecture_decisions.slice(-2).join(" | ")}`);
    }
  }

  // ── Recent meaningful sessions (not CHAT, not MEMORY_UPDATE) ──
  const meaningful = sessions
    .filter(s => s.classified_intent !== "CHAT" && s.classified_intent !== "MEMORY_UPDATE")
    .slice(-3);
  if (meaningful.length > 0) {
    lines.push("آخر الأنشطة:");
    for (const s of meaningful) {
      lines.push(`  [${s.action_taken}] ${s.result_summary.slice(0, 70)}`);
    }
  }

  MEM(`recall applied  tech=${isTechnical}  rules=${ruleKeys.length}  sessions=${meaningful.length}`);
  return lines.join("\n");
}
