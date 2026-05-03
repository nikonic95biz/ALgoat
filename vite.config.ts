import path from "node:path";
import http from "node:http";
import https from "node:https";
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

const rawBase = process.env.VITE_BASE_PATH?.trim() ?? "";
const viteBase =
  !rawBase || rawBase === "/"
    ? "/"
    : `/${rawBase.replace(/^\/+|\/+$/g, "")}/`;

const outDir = rawBase ? `dist/${rawBase.replace(/^\/+|\/+$/g, "")}` : "dist";

export default defineConfig({
  base: viteBase,
  build: { outDir },
  plugins: [react(), tailwindcss(), llmDevProxyPlugin()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/pump-api": pumpProxy,
      "/pump-frontend": pumpFrontendProxy,
    },
  },
  preview: {
    proxy: {
      "/pump-api": pumpProxy,
      "/pump-frontend": pumpFrontendProxy,
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
