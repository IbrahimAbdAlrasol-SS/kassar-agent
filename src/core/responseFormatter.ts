import { logger } from "../utils/logger.js";
import type { AgentResponse } from "./types.js";
import type { SearchResultItem } from "../tools/search-web.js";

type FormatType = "SEARCH" | "FILE" | "TERMINAL" | "CHAT" | "GENERIC";

interface SearchData {
  query:      string;
  results:    SearchResultItem[];
  structured: boolean;
}

const FMT = (msg: string) => logger.info(`[FORMAT] ${msg}`);

function detectType(resp: AgentResponse): FormatType {
  if (resp.route !== "tool") return "CHAT";
  switch (resp.toolName) {
    case "search_web":   return "SEARCH";
    case "read_file":    return "FILE";
    case "run_terminal": return "TERMINAL";
    default:             return "GENERIC";
  }
}

function formatSearch(resp: AgentResponse): string {
  const data = resp.toolData as SearchData | undefined;

  if (!resp.success) {
    FMT(`type=SEARCH  status=failed`);
    return `❌ فشل البحث: ${resp.error ?? resp.content}`;
  }

  if (data?.structured && data.results.length > 0) {
    const items = data.results.slice(0, 5);
    const q     = data.query || "";

    const lines: string[] = [];
    if (q) lines.push(`🔍 *${escapeMarkdown(q)}*\n`);

    items.forEach((item, i) => {
      const title   = item.title.trim();
      const snippet = item.snippet.trim();
      if (title)   lines.push(`*${i + 1}\\. ${escapeMarkdown(title)}*`);
      if (snippet) lines.push(escapeMarkdown(snippet.slice(0, 200)));
      if (item.url) lines.push(`🔗 ${item.url}`);
      lines.push("");
    });

    const sources = items
      .filter((r) => r.url)
      .map((r, i) => `${i + 1}\\. ${r.url}`)
      .join("\n");
    if (sources) lines.push(`📎 *المصادر:*\n${sources}`);

    FMT(`type=SEARCH  structured=${items.length} results  query="${q}"`);
    return lines.join("\n").trim();
  }

  const raw = (resp.content ?? "").trim();
  if (!raw || raw === "(no results found)") {
    FMT(`type=SEARCH  status=empty`);
    return "لم تُوجَد نتائج لهذا البحث\\.";
  }

  const preview = raw.slice(0, 600);
  FMT(`type=SEARCH  fallback  chars=${preview.length}`);
  return `🔍 *نتائج البحث:*\n\n${escapeMarkdown(preview)}`;
}

function formatFile(resp: AgentResponse): string {
  if (!resp.success) {
    FMT(`type=FILE  status=failed`);
    return `❌ تعذّر قراءة الملف: ${escapeMarkdown(resp.error ?? resp.content)}`;
  }

  const content = (resp.content ?? "").trim();
  if (!content) {
    FMT(`type=FILE  status=empty`);
    return "📄 الملف فارغ\\.";
  }

  const preview   = content.slice(0, 1_500);
  const truncated = content.length > 1_500;
  FMT(`type=FILE  chars=${preview.length}  truncated=${truncated}`);
  return `📄 *محتوى الملف:*\n\`\`\`\n${preview}${truncated ? "\n…(مقتطع)" : ""}\n\`\`\``;
}

function formatTerminal(resp: AgentResponse): string {
  if (!resp.success) {
    FMT(`type=TERMINAL  status=failed`);
    const err = (resp.error ?? resp.content).trim().slice(0, 500);
    return `❌ *فشل تنفيذ الأمر:*\n\`\`\`\n${err}\n\`\`\``;
  }

  const out = (resp.content ?? "").trim();
  if (!out) {
    FMT(`type=TERMINAL  status=no-output`);
    return "✅ تم تنفيذ الأمر بنجاح\\. \\(لا يوجد output\\)";
  }

  const preview   = out.slice(0, 1_500);
  const truncated = out.length > 1_500;
  FMT(`type=TERMINAL  chars=${preview.length}  truncated=${truncated}`);
  return `✅ *تم:*\n\`\`\`\n${preview}${truncated ? "\n…(مقتطع)" : ""}\n\`\`\``;
}

function formatChat(resp: AgentResponse): string {
  FMT(`type=CHAT  chars=${(resp.content ?? "").length}`);
  const text = (resp.content ?? "").trim();
  if (!text) return "\\.\\.";
  return text;
}

function formatGeneric(resp: AgentResponse): string {
  FMT(`type=GENERIC  toolName=${resp.toolName ?? "none"}  success=${resp.success}`);
  if (!resp.success) {
    return `❌ ${escapeMarkdown(resp.error ?? resp.content)}`;
  }
  const text = (resp.content ?? "").trim().slice(0, 1_500);
  return text || "✅ تم\\.";
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export interface FormattedResponse {
  text:       string;
  parseMode:  "MarkdownV2" | "HTML" | undefined;
  formatType: FormatType;
}

export function formatResponse(resp: AgentResponse): FormattedResponse {
  const type = detectType(resp);

  let text: string;
  switch (type) {
    case "SEARCH":   text = formatSearch(resp);   break;
    case "FILE":     text = formatFile(resp);     break;
    case "TERMINAL": text = formatTerminal(resp); break;
    case "CHAT":     text = formatChat(resp);     break;
    default:         text = formatGeneric(resp);  break;
  }

  const usesMarkdown = type !== "CHAT";

  return {
    text,
    parseMode:  usesMarkdown ? "MarkdownV2" : undefined,
    formatType: type,
  };
}
