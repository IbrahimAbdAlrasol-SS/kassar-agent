import https from "https";
import http from "http";
import { URL } from "url";
import { BaseTool, type ToolResult, type ToolSchema } from "./base-tool.js";

export interface SearchResultItem {
  title:   string;
  url:     string;
  snippet: string;
}

function fetchHtml(urlStr: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === "https:" ? https : http;

    const req = client.get(
      urlStr,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; kassar-agent/1.0)",
          Accept: "text/html",
          "Accept-Language": "ar,en;q=0.9",
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchHtml(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 80_000) req.destroy();
        });
        res.on("end", () => resolve(body));
        res.on("error", reject);
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function cleanText(s: string): string {
  return decodeHtmlEntities(stripTags(s)).trim();
}

function extractResults(html: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const resultBlockRe = /<div class="result[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
  const titleRe       = /class="result__a"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe     = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
  const displayUrlRe  = /class="result__url"[^>]*>([\s\S]*?)<\/a>/;
  const hrefRe        = /class="result__a"\s+href="([^"]+)"/;

  let match: RegExpExecArray | null;

  while ((match = resultBlockRe.exec(html)) !== null && results.length < 7) {
    const block = match[0];

    const titleMatch      = titleRe.exec(block);
    const snippetMatch    = snippetRe.exec(block);
    const displayUrlMatch = displayUrlRe.exec(block);
    const hrefMatch       = hrefRe.exec(block);

    if (!titleMatch || !snippetMatch) continue;

    const title   = cleanText(titleMatch[1]);
    const snippet = cleanText(snippetMatch[1]);
    const displayUrl = displayUrlMatch ? cleanText(displayUrlMatch[1]) : "";

    let url = displayUrl;
    if (!url && hrefMatch) {
      const rawHref = hrefMatch[1];
      try {
        const uddgParam = new URL("https://duckduckgo.com" + rawHref).searchParams.get("uddg");
        if (uddgParam) url = decodeURIComponent(uddgParam);
        else url = rawHref;
      } catch {
        url = rawHref;
      }
    }

    if (title && snippet) {
      results.push({ title, url: url || "", snippet });
    }
  }

  return results;
}

function fallbackTextExtract(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi,   "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g,  "&")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 2_000);
}

export class SearchWebTool extends BaseTool {
  readonly name        = "search_web";
  readonly description = "Search the web and return structured results";
  readonly risk_level  = "LOW" as const;
  readonly schema: ToolSchema = {
    name:        "search_web",
    description: this.description,
    input: {
      query: { type: "string", description: "Search query", required: true },
    },
    risk_level: "LOW",
  };

  protected async run(input: Record<string, unknown>): Promise<ToolResult> {
    const query = String(input["query"] ?? "").trim();
    if (!query) return { success: false, output: "", error: "No query provided" };

    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html      = await fetchHtml(searchUrl);

    const items = extractResults(html);

    if (items.length > 0) {
      return {
        success: true,
        output:  JSON.stringify(items),
        data:    { query, results: items, structured: true },
      };
    }

    const fallback = fallbackTextExtract(html);
    return {
      success: true,
      output:  fallback || "(no results found)",
      data:    { query, results: [], structured: false },
    };
  }
}
