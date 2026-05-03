export type ChatEdit = {
  path: string;
  lang: string;
  code: string;
  /** True when the fence info string contains "(new)" — signals file creation. */
  isNew: boolean;
};

export type AlgoBlock = {
  name: string;
  description: string;
};

/**
 * Extract fenced code blocks that have a filename annotation on the opening fence.
 *
 * Supported fence info formats:
 *   ```typescript:src/lib/foo.ts
 *   ```typescript:src/lib/foo.ts (new)
 *   ```ts:src/lib/foo.ts
 *   ```src/lib/foo.ts            ← no language prefix, path contains "/"
 */
export function parseChatEdits(content: string): ChatEdit[] {
  const edits: ChatEdit[] = [];
  const seen = new Set<string>();

  const FENCE_RE = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(content)) !== null) {
    const info = match[1].trim();
    const code = match[2];

    if (!info) continue;
    // Skip algo / mint blocks — handled separately
    if (info === "algo" || info === "mint") continue;
    // Skip followup comment blocks
    if (info.startsWith("!--")) continue;

    const isNewFlag = /\(new\)/i.test(info);
    const cleanInfo = info.replace(/\(new\)/i, "").trim();

    const colonIdx = cleanInfo.indexOf(":");
    if (colonIdx !== -1) {
      const lang = cleanInfo.slice(0, colonIdx).trim();
      const path = cleanInfo.slice(colonIdx + 1).trim();
      if (isFilePath(path) && !seen.has(path)) {
        seen.add(path);
        edits.push({ path, lang: lang || "plaintext", code, isNew: isNewFlag });
        continue;
      }
    }

    // Bare path (no colon) — must contain "/" and have known extension
    if (isFilePath(cleanInfo) && cleanInfo.includes("/") && !seen.has(cleanInfo)) {
      seen.add(cleanInfo);
      edits.push({ path: cleanInfo, lang: "plaintext", code, isNew: isNewFlag });
    }
  }

  return edits;
}

/**
 * Extract `algo` fenced blocks from an LLM response:
 * ```algo
 * Name: Fast Scalper
 * Description: Aggressive dip-buy with tight stop
 * ```
 */
export function parseAlgoBlocks(content: string): AlgoBlock[] {
  const out: AlgoBlock[] = [];
  const ALGO_RE = /^```algo\n([\s\S]*?)^```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = ALGO_RE.exec(content)) !== null) {
    const body = m[1];
    const nameMatch = /^Name:\s*(.+)$/im.exec(body);
    const descMatch = /^Description:\s*(.+)$/im.exec(body);
    const name = nameMatch?.[1]?.trim();
    const description = descMatch?.[1]?.trim() ?? "";
    if (name) out.push({ name, description });
  }
  return out;
}

/**
 * Extract suggested follow-up prompts from the LLM response.
 * The LLM is instructed to append them as an HTML comment:
 *
 * <!-- followups
 * - Make the stop loss tighter
 * - Add a volume filter
 * -->
 *
 * Returns the prompts and strips the comment block from the rendered content.
 */
export function parseSuggestedFollowups(content: string): {
  followups: string[];
  cleanContent: string;
} {
  const FOLLOWUP_RE = /<!--\s*followups\s*\n([\s\S]*?)-->/gi;
  const followups: string[] = [];
  const cleanContent = content.replace(FOLLOWUP_RE, (_match, body: string) => {
    const lines = body.split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, "").trim();
      if (cleaned) followups.push(cleaned);
    }
    return "";
  }).trim();
  return { followups, cleanContent };
}

/** Solana mint (base58), typical length. */
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Extract ```mint fences — drives “Load chart” buttons in chat.
 * ```mint
 * So11111111111111111111111111111111111111112
 * ```
 */
export function parseMintDirectives(content: string): string[] {
  const out: string[] = [];
  const re = /^```mint\s*\n\s*([^\n`]+)\s*\n```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const addr = m[1].trim();
    if (SOLANA_MINT_RE.test(addr)) out.push(addr);
  }
  return [...new Set(out)];
}

function isFilePath(s: string): boolean {
  if (!s || s.includes(" ")) return false;
  // Accept dotfiles like .gitignore, .eslintrc
  if (s.startsWith(".") && !s.slice(1).includes(".")) return true;
  // Accept extensionless known build files (Makefile, Dockerfile, etc.)
  if (/^[A-Z][a-zA-Z]+file$/.test(s.split("/").pop() ?? "")) return true;
  const parts = s.split(".");
  if (parts.length < 2) return false;
  const ext = parts.pop() ?? "";
  if (ext.length === 0 || ext.length > 8) return false;
  return /^[a-zA-Z0-9]+$/.test(ext);
}
