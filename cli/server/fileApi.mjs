/**
 * SolClaw local file API server — port 58472
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import { readdirSync, statSync } from "node:fs";

export const FILE_API_PORT = 58472;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", "coverage"]);
const SKIP_EXTS = new Set([".png",".jpg",".jpeg",".gif",".webp",".ico",".woff",".woff2",".ttf",".eot",".zip",".lock"]);

function walkDir(dir, root, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      walkDir(abs, root, out);
    } else {
      const dotIdx = name.lastIndexOf(".");
      const ext = dotIdx !== -1 ? name.slice(dotIdx) : "";
      if (SKIP_EXTS.has(ext)) continue;
      if (stat.size > 900_000) continue;
      out.push(relative(root, abs));
    }
  }
  return out;
}

function cors(res, req) {
  // Allow any localhost/127.0.0.1 origin regardless of port
  const origin = req?.headers?.origin ?? "";
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : "http://localhost:5173";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, data, status = 200, req = null) {
  cors(res, req);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export let latestTypecheckResult = { clean: true, errors: [], checkedAt: null };
export function setTypecheckResult(result) { latestTypecheckResult = result; }

export function startFileApiServer(repoRoot) {
  const root = resolve(repoRoot);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${FILE_API_PORT}`);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") { cors(res, req); res.writeHead(204); res.end(); return; }

    if (req.method === "GET" && pathname === "/health") {
      return json(res, { ok: true, root }, 200, req);
    }

    if (req.method === "GET" && pathname === "/files") {
      const paths = walkDir(root, root).sort();
      return json(res, { paths }, 200, req);
    }

    if (req.method === "GET" && pathname === "/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) return json(res, { error: "Missing path param" }, 400, req);
      const abs = resolve(root, filePath);
      if (!abs.startsWith(root)) return json(res, { error: "Path outside repo" }, 403, req);
      try {
        const content = await readFile(abs, "utf8");
        return json(res, { content, path: filePath }, 200, req);
      } catch { return json(res, { error: "File not found" }, 404, req); }
    }

    if (req.method === "POST" && pathname === "/file") {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: "Invalid JSON" }, 400, req); }
      const { path: filePath, content } = body;
      if (!filePath || typeof content !== "string") return json(res, { error: "Missing path or content" }, 400, req);
      const abs = resolve(root, filePath);
      if (!abs.startsWith(root)) return json(res, { error: "Path outside repo" }, 403, req);
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return json(res, { ok: true, path: filePath }, 200, req);
      } catch (e) { return json(res, { error: String(e) }, 500, req); }
    }

    if (req.method === "GET" && pathname === "/typecheck") {
      return json(res, latestTypecheckResult, 200, req);
    }

    cors(res, req); res.writeHead(404); res.end("Not found");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`  \u26a0 File API:   port ${FILE_API_PORT} already in use — kill other solclaw processes first`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(FILE_API_PORT, "127.0.0.1", () => {
    console.log(`  \u2713 File API:   http://127.0.0.1:${FILE_API_PORT}`);
  });

  return server;
}
