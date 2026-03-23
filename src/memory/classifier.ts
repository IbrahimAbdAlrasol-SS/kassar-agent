import { logger } from "../utils/logger.js";

export type MemoryCategory = "USER" | "RULE" | "PROJECT" | "SESSION" | "SKIP";

export interface Classification {
  category: MemoryCategory;
  subtype:  string;
  value:    string;
  label?:   string;
}

const MEM = (msg: string) => logger.info(`[MEMORY] ${msg}`);

// ─── Greeting / small-talk detector ────────────────────────────────────────
const SKIP_PATTERNS = [
  /^(مرحب[اً]?|هلا|سلام|أهلا|اهلا|صباح|مساء|شكراً?|شكرا|تمام|ماشي|أوكي|اوكي|حسناً?|موافق|جيد|عظيم|رائع)\b/u,
  /^(hi|hello|hey|thanks|thank you|ok|okay|great|got it|sure|cool|nice)\b/i,
  /^كيف\s+(حالك|الحال|أحوالك|أمورك)\b/u,
  /^(ما\s+اسمك|من\s+أنت|من\s+انت)\b/u,
  /^(what.{0,8}your\s+name|who\s+are\s+you)\b/i,
];

// ─── Explicit USER-memory patterns ─────────────────────────────────────────
const USER_PATTERNS: Array<[RegExp, string, string?]> = [
  [/^(?:انا\s+|أنا\s+)?اسمي\s+(?:هو\s+)?(.+)$/u,                    "preferred_name"],
  [/^ناديني\s+(?:باسم\s+)?(.+)$/u,                                   "preferred_name"],
  [/^غيّ?ر\s+(?:اسمي|الاسم)\s+(?:إلى|الى|الي)\s+(.+)$/u,           "preferred_name"],
  [/^غيّ?ره?\s+(?:إلى|الى|الي)\s+(.+)$/u,                           "preferred_name"],
  [/^(?:my\s+)?name\s+is\s+(.+)$/i,                                  "preferred_name"],
  [/^call\s+me\s+(.+)$/i,                                            "preferred_name"],
  [/^change\s+(?:my\s+)?name\s+to\s+(.+)$/i,                        "preferred_name"],
  [/^ردود?\s+(?:بشكل\s+)?(موجز[ة]?|مختصر[ة]?|قصير[ة]?)$/u,        "response_style_concise"],
  [/^ردود?\s+(?:بشكل\s+)?(مفصّ?ل[ة]?|مطوّ?ل[ة]?)$/u,             "response_style_detailed"],
  [/^(?:أفضّ?ل|أحب)\s+الردود\s+ال(موجزة|مختصرة|مفصلة|مطولة)/u,    "response_style_pref"],
  [/^لغتي\s+(?:المفضلة\s+)?(?:هي\s+)?(.+)$/u,                      "preferred_language"],
  [/^تحدث\s+(?:معي\s+)?(?:دائماً?\s+)?(?:بال|ب)(.+)$/u,           "preferred_language"],
];

// ─── Explicit RULE patterns ─────────────────────────────────────────────────
const RULE_PATTERNS: Array<[RegExp, string]> = [
  [/^لا\s+تفعل\s+(.+)$/u,                                           "forbidden"],
  [/^لا\s+تقل\s+(.+)$/u,                                            "forbidden"],
  [/^لا\s+تستخدم\s+(.+)$/u,                                         "forbidden"],
  [/^لا\s+تلمس\s+(.+)$/u,                                           "forbidden"],
  [/^لا\s+تحذف\s+(.+)$/u,                                           "forbidden"],
  [/^لا\s+تشغّ?ل\s+(.+)$/u,                                        "forbidden"],
  [/^ممنوع\s+(.+)$/u,                                               "forbidden"],
  [/^من\s+الآن\s+(?:وصاعداً?\s+)?(.+)$/u,                          "rule"],
  [/^من\s+الان\s+(?:وصاعداً?\s+)?(.+)$/u,                          "rule"],
  [/^اسألني\s+(?:دائماً?\s+)?قبل\s+(.+)$/u,                        "ask_before"],
  [/^from\s+now\s+on[,]?\s+(.+)$/i,                                 "rule"],
  [/^don[''']?t\s+(touch|delete|run|use|modify)\s+(.+)$/i,          "forbidden"],
  [/^always\s+ask\s+(?:me\s+)?before\s+(.+)$/i,                     "ask_before"],
  [/^never\s+(.+)$/i,                                               "forbidden"],
];

// ─── PROJECT memory patterns ────────────────────────────────────────────────
const PROJECT_PATTERNS: Array<[RegExp, string]> = [
  [/^احفظ\s+هذا\s+للمشروع[:,\s]+(.+)$/u,                           "note"],
  [/^المشروع\s+يستخدم\s+(.+)$/u,                                    "stack"],
  [/^(?:نستخدم|يستخدم\s+المشروع)\s+(.+)$/u,                        "stack"],
  [/^(?:تقرر\s+أن|قررنا)\s+(.+)$/u,                                 "architecture_decision"],
  [/^المسار\s+المهم[:،]\s*(.+)$/u,                                  "important_path"],
  [/^(?:مهمة\s+مفتوحة|open\s+task)[:،]?\s*(.+)$/ui,                "open_task"],
  [/^رفضنا\s+(?:فكرة\s+)?(.+)$/u,                                   "rejected_approach"],
  [/^save\s+(?:this\s+)?(?:for\s+)?(?:the\s+)?project[:,]?\s+(.+)$/i, "note"],
];

// ─── NOTE patterns (USER category, goes in notes[]) ────────────────────────
const NOTE_PATTERNS: Array<[RegExp]> = [
  [/^تذكر\s+(?:أن\s+|ان\s+)?(.+)$/u],
  [/^remember\s+(?:that\s+)?(.+)$/i],
];

// ─── Main classifier ────────────────────────────────────────────────────────
export function classifyMemoryIntent(text: string): Classification | null {
  const t = text.trim();

  // 1. Skip greetings / small-talk
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(t)) {
      MEM("skipped (small-talk/greeting)");
      return { category: "SKIP", subtype: "greeting", value: t };
    }
  }

  // 2. Note patterns → USER
  for (const [pat] of NOTE_PATTERNS) {
    const m = t.match(pat);
    if (m) {
      const val = (m[1] ?? t).trim();
      MEM(`classified as USER  subtype=note`);
      return { category: "USER", subtype: "note", value: val };
    }
  }

  // 3. User-memory patterns
  for (const [pat, subtype] of USER_PATTERNS) {
    const m = t.match(pat);
    if (m) {
      const val = (m[1] ?? t).trim();
      MEM(`classified as USER  subtype=${subtype}`);
      return { category: "USER", subtype, value: val };
    }
  }

  // 4. Rule patterns
  for (const [pat, subtype] of RULE_PATTERNS) {
    const m = t.match(pat);
    if (m) {
      const val = (m[1] ?? m[0]).trim();
      MEM(`classified as RULE  subtype=${subtype}`);
      return { category: "RULE", subtype, value: val, label: t.slice(0, 60) };
    }
  }

  // 5. Project patterns
  for (const [pat, subtype] of PROJECT_PATTERNS) {
    const m = t.match(pat);
    if (m) {
      const val = (m[1] ?? t).trim();
      MEM(`classified as PROJECT  subtype=${subtype}`);
      return { category: "PROJECT", subtype, value: val };
    }
  }

  return null;
}

// ─── Session save filter ────────────────────────────────────────────────────
export function shouldSaveSession(intent: string, action: string): boolean {
  if (intent === "MEMORY_UPDATE") return false;
  if (action === "memory:preferred_name") return false;
  if (intent === "CHAT" && action === "response") return false;
  if (intent === "SELF_DESCRIPTION") return false;
  if (intent === "CLARIFICATION") return false;
  return true;
}
