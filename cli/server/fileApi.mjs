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

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:58471");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, data, status = 200) {
  cors(res);
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

    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    if (req.method === "GET" && pathname === "/health") {
      return json(res, { ok: true, root });
    }

    if (req.method === "GET" && pathname === "/files") {
      const paths = walkDir(root, root).sort();
      return json(res, { paths });
    }

    if (req.method === "GET" && pathname === "/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) return json(res, { error: "Missing path param" }, 400);
      const abs = resolve(root, filePath);
      if (!abs.startsWith(root)) return json(res, { error: "Path outside repo" }, 403);
      try {
        const content = await readFile(abs, "utf8");
        return json(res, { content, path: filePath });
      } catch { return json(res, { error: "File not found" }, 404); }
    }

    if (req.method === "POST" && pathname === "/file") {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: "Invalid JSON" }, 400); }
      const { path: filePath, content } = body;
      if (!filePath || typeof content !== "string") return json(res, { error: "Missing path or content" }, 400);
      const abs = resolve(root, filePath);
      if (!abs.startsWith(root)) return json(res, { error: "Path outside repo" }, 403);
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return json(res, { ok: true, path: filePath });
      } catch (e) { return json(res, { error: String(e) }, 500); }
    }

    if (req.method === "GET" && pathname === "/typecheck") {
      return json(res, latestTypecheckResult);
    }

    cors(res); res.writeHead(404); res.end("Not found");
  });

  server.listen(FILE_API_PORT, "127.0.0.1", () => {
    console.log(`  \u2713 File API:   http://127.0.0.1:${FILE_API_PORT}`);
  });

  return server;
}
