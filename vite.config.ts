import path from "node:path";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import type { IncomingMessage } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Connect, Plugin } from "vite";

const pumpProxy = {
  target: "https://swap-api.pump.fun",
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/pump-api/, ""),
} as const;

const pumpFrontendProxy = {
  target: "https://frontend-api.pump.fun",
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/pump-frontend/, ""),
} as const;

const dexscreenerProxy = {
  target: "https://api.dexscreener.com",
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/dex-api/, ""),
} as const;

const solanaRpcProxy = {
  target: "https://api.mainnet-beta.solana.com",
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/sol-rpc/, "/"),
} as const;

const LLM_PROXY_TARGETS: Record<string, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  github: "https://api.github.com",
  groq: "https://api.groq.com",
  openrouter: "https://openrouter.ai",
  together: "https://api.together.xyz",
  mistral: "https://api.mistral.ai",
  deepseek: "https://api.deepseek.com",
  xai: "https://api.x.ai",
  perplexity: "https://api.perplexity.ai",
  "google-ai": "https://generativelanguage.googleapis.com",
  ollama: "http://127.0.0.1:11434",
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * Build outgoing headers so Bearer auth survives (`http-proxy` in older preview setups dropped it).
 */
function llmForwardHeaders(req: IncomingMessage, upstreamHost: string): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (val === undefined) continue;
    const kl = key.toLowerCase();
    if (HOP_BY_HOP.has(kl)) continue;
    if (kl === "x-unt-llm-authorization") continue;
    out[key] = val;
  }

  const direct = req.headers.authorization;
  const directStr =
    typeof direct === "string" ? direct : Array.isArray(direct) && direct[0] ? direct[0] : "";
  const alt = req.headers["x-unt-llm-authorization"];
  const altStr = typeof alt === "string" ? alt : Array.isArray(alt) && alt[0] ? alt[0] : "";
  let bearer = directStr.trim() || altStr.trim();
  if (bearer) {
    if (!/^Bearer\s+/i.test(bearer)) {
      bearer = `Bearer ${bearer}`;
    }
    out.Authorization = bearer;
  }

  out.host = upstreamHost;
  return out;
}

/**
 * `/__proxy/llm/*` via Node `http(s).request` (not `http-proxy`) so `Authorization` always reaches the provider.
 * Mounted on both dev (`vite`) and preview (`vite preview`) — preview’s built-in proxy dropped Bearer on some setups.
 */
function createLlmProxyMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const raw = req.url ?? "";
    const pathname = raw.split("?")[0] ?? "";
    const prefix = "/__proxy/llm/";
    if (!pathname.startsWith(prefix)) {
      next();
      return;
    }

    const tail = pathname.slice(prefix.length);
    const slash = tail.indexOf("/");
    const slug = slash === -1 ? tail : tail.slice(0, slash);
    const upstreamPath = slash === -1 ? "/" : tail.slice(slash);
    const originBase = LLM_PROXY_TARGETS[slug];
    if (!slug || !originBase) {
      next();
      return;
    }

    const query = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
    const normalizedPath = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
    let targetUrl: URL;
    try {
      targetUrl = new URL(normalizedPath + query, originBase.endsWith("/") ? originBase : `${originBase}/`);
    } catch {
      res.statusCode = 400;
      res.end("Bad proxy URL");
      return;
    }

    const lib = targetUrl.protocol === "https:" ? https : http;

    const reqOpts: https.RequestOptions = {
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method || "GET",
      headers: llmForwardHeaders(req as IncomingMessage, targetUrl.host),
    };
    if (targetUrl.port) {
      reqOpts.port = Number(targetUrl.port);
    }

    const outgoing = lib.request(
      reqOpts,
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );

    outgoing.on("error", (err) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.end(`LLM proxy error: ${err.message}`);
    });

    req.pipe(outgoing);
    req.on("aborted", () => outgoing.destroy());
  };
}

function llmDevProxyPlugin(): Plugin {
  const mw = createLlmProxyMiddleware();
  return {
    name: "unt-llm-dev-proxy",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}

// ─── Local IDE Agent Middleware ───────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const AGENT_PREFIX = "/__agent";
const SKIP_AGENT_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage", "public/bundled-workspace"]);
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".md", ".mjs", ".cjs", ".yml", ".yaml"]);
let latestBrowserSnapshot: { url: string; title: string; text: string; at: number } | null = null;
let latestBrowserConsole: Array<{ level: string; message: string; at: number }> = [];
type EditRecord = {
  id: string;
  path: string;
  before: string | null;
  after: string;
  at: number;
};
let editHistory: EditRecord[] = [];

function safeResolve(relPath: string): string {
  const cleaned = String(relPath || "").replace(/^\/+/, "");
  const abs = path.resolve(PROJECT_ROOT, cleaned);
  const root = path.resolve(PROJECT_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return abs;
}

function isTextPath(relPath: string): boolean {
  return TEXT_EXTS.has(path.extname(relPath).toLowerCase());
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(res: Connect.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function listFilesFromDisk(prefix = "src", maxFiles = 800): Promise<string[]> {
  const out: string[] = [];
  async function walk(absDir: string, relDir: string) {
    if (out.length >= maxFiles) return;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if ([...SKIP_AGENT_DIRS].some((skip) => rel === skip || rel.startsWith(skip + "/"))) continue;
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile() && isTextPath(rel)) {
        out.push(rel);
      }
    }
  }
  const startRel = String(prefix || "").replace(/^\/+|\/+$/g, "") || "";
  await walk(safeResolve(startRel || "."), startRel);
  return out.sort();
}

async function searchCode(query: string, prefix = "src", maxResults = 80): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await listFilesFromDisk(prefix, 1000);
  const q = query.toLowerCase();
  const results: Array<{ path: string; line: number; text: string }> = [];
  for (const rel of files) {
    if (results.length >= maxResults) break;
    const text = await fs.readFile(safeResolve(rel), "utf8").catch(() => "");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(q)) {
        results.push({ path: rel, line: i + 1, text: lines[i]!.slice(0, 240) });
        if (results.length >= maxResults) break;
      }
    }
  }
  return results;
}

function runCommand(command: string, args: string[], timeoutMs = 60_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, shell: false });
    let output = "";
    const timer = setTimeout(() => {
      output += `\n[agent] timed out after ${timeoutMs / 1000}s`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (d) => { output += d.toString(); });
    child.stderr.on("data", (d) => { output += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(-20_000) });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: err.message });
    });
  });
}

function createIdeAgentMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const raw = req.url ?? "";
    const pathname = raw.split("?")[0] ?? "";
    if (!pathname.startsWith(AGENT_PREFIX)) {
      next();
      return;
    }

    try {
      if (req.method === "GET" && pathname === `${AGENT_PREFIX}/status`) {
        sendJson(res, 200, {
          ok: true,
          root: PROJECT_ROOT,
          tools: [
            "read_file",
            "write_file",
            "list_files",
            "search_code",
            "run_typecheck",
            "run_build",
            "get_dom_snapshot",
            "assert_text_visible",
            "get_console_errors",
            "get_edit_history",
            "rollback_edit",
          ],
          browserSnapshotAt: latestBrowserSnapshot?.at ?? null,
          editHistoryCount: editHistory.length,
        });
        return;
      }

      if (req.method === "POST" && pathname === `${AGENT_PREFIX}/browser-snapshot`) {
        const body = await readJsonBody(req as IncomingMessage);
        latestBrowserSnapshot = {
          url: String(body.url ?? ""),
          title: String(body.title ?? ""),
          text: String(body.text ?? "").slice(0, 50_000),
          at: Date.now(),
        };
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === `${AGENT_PREFIX}/browser-console`) {
        const body = await readJsonBody(req as IncomingMessage);
        latestBrowserConsole.push({
          level: String(body.level ?? "log"),
          message: String(body.message ?? "").slice(0, 2000),
          at: Date.now(),
        });
        latestBrowserConsole = latestBrowserConsole.slice(-80);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method !== "POST" || pathname !== `${AGENT_PREFIX}/tool`) {
        sendJson(res, 404, { ok: false, error: "Unknown agent endpoint" });
        return;
      }

      const body = await readJsonBody(req as IncomingMessage);
      const tool = String(body.tool ?? "");
      const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;

      if (tool === "read_file") {
        const rel = String(input.path ?? "");
        if (!isTextPath(rel)) throw new Error(`Refusing to read non-text file: ${rel}`);
        const content = await fs.readFile(safeResolve(rel), "utf8");
        sendJson(res, 200, { ok: true, content });
        return;
      }

      if (tool === "write_file") {
        const rel = String(input.path ?? "");
        const content = String(input.content ?? "");
        if (!isTextPath(rel)) throw new Error(`Refusing to write non-text file: ${rel}`);
        const abs = safeResolve(rel);
        const before = await fs.readFile(abs, "utf8").catch(() => null);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
        const written = await fs.readFile(abs, "utf8");
        const ok = written === content;
        let editId: string | null = null;
        if (ok) {
          editId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          editHistory.push({ id: editId, path: rel, before, after: content, at: Date.now() });
          editHistory = editHistory.slice(-80);
        }
        sendJson(res, 200, {
          ok,
          editId,
          content: ok ? `Wrote and verified ${rel}. editId=${editId}` : `Write verification failed for ${rel}`,
        });
        return;
      }

      if (tool === "list_files") {
        sendJson(res, 200, { ok: true, files: await listFilesFromDisk(String(input.prefix ?? "src")) });
        return;
      }

      if (tool === "search_code") {
        sendJson(res, 200, { ok: true, results: await searchCode(String(input.query ?? ""), String(input.prefix ?? "src")) });
        return;
      }

      if (tool === "run_typecheck") {
        const result = await runCommand("npm", ["run", "typecheck"], 90_000);
        sendJson(res, 200, { ok: result.code === 0, ...result });
        return;
      }

      if (tool === "run_build") {
        const result = await runCommand("npm", ["run", "build"], 120_000);
        sendJson(res, 200, { ok: result.code === 0, ...result });
        return;
      }

      if (tool === "get_dom_snapshot") {
        sendJson(res, 200, {
          ok: Boolean(latestBrowserSnapshot),
          content: latestBrowserSnapshot
            ? `URL: ${latestBrowserSnapshot.url}\nTitle: ${latestBrowserSnapshot.title}\nAt: ${new Date(latestBrowserSnapshot.at).toISOString()}\n\n${latestBrowserSnapshot.text}`
            : "No browser snapshot has been reported yet. Open the app in the browser and wait a moment.",
        });
        return;
      }

      if (tool === "assert_text_visible") {
        const text = String(input.text ?? "");
        const haystack = latestBrowserSnapshot?.text ?? "";
        const ok = Boolean(text) && haystack.toLowerCase().includes(text.toLowerCase());
        sendJson(res, 200, {
          ok,
          content: ok
            ? `OK — "${text}" is visible in the running app.`
            : `ERROR — "${text}" is not visible in the latest running app snapshot.`,
        });
        return;
      }

      if (tool === "get_console_errors") {
        const errors = latestBrowserConsole.filter((m) => ["error", "warn"].includes(m.level));
        sendJson(res, 200, {
          ok: errors.length === 0,
          content: errors.length
            ? errors.map((m) => `${new Date(m.at).toISOString()} [${m.level}] ${m.message}`).join("\n")
            : "No browser console errors or warnings reported.",
        });
        return;
      }

      if (tool === "get_edit_history") {
        sendJson(res, 200, {
          ok: true,
          content: editHistory.length
            ? editHistory.slice(-20).map((e) => `${e.id} | ${new Date(e.at).toISOString()} | ${e.path}`).join("\n")
            : "No edit history yet.",
        });
        return;
      }

      if (tool === "rollback_edit") {
        const editId = String(input.editId ?? "");
        const record = [...editHistory].reverse().find((e) => e.id === editId) ?? editHistory.at(-1);
        if (!record) {
          sendJson(res, 200, { ok: false, content: "ERROR: no edit record available to rollback." });
          return;
        }
        const abs = safeResolve(record.path);
        if (record.before === null) {
          await fs.rm(abs, { force: true });
        } else {
          await fs.writeFile(abs, record.before, "utf8");
        }
        sendJson(res, 200, {
          ok: true,
          content: `Rolled back ${record.path} to before ${record.id}.`,
        });
        return;
      }

      sendJson(res, 400, { ok: false, error: `Unknown tool: ${tool}` });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}

function ideAgentPlugin(): Plugin {
  const mw = createIdeAgentMiddleware();
  return {
    name: "algoat-local-ide-agent",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(mw);
    },
  };
}

const rawBase = process.env.VITE_BASE_PATH?.trim() ?? "";
const viteBase =
  !rawBase || rawBase === "/"
    ? "/"
    : `/${rawBase.replace(/^\/+|\/+$/g, "")}/`;

const outDir = rawBase ? `dist/${rawBase.replace(/^\/+|\/+$/g, "")}` : "dist";

export default defineConfig({
  base: viteBase,
  build: { outDir },
  plugins: [react(), tailwindcss(), llmDevProxyPlugin(), ideAgentPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/pump-api": pumpProxy,
      "/pump-frontend": pumpFrontendProxy,
      "/dex-api": dexscreenerProxy,
      "/sol-rpc": solanaRpcProxy,
    },
  },
  preview: {
    proxy: {
      "/pump-api": pumpProxy,
      "/pump-frontend": pumpFrontendProxy,
      "/dex-api": dexscreenerProxy,
      "/sol-rpc": solanaRpcProxy,
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
