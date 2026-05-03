/**
 * Copies a text snapshot of the repo into public/bundled-workspace/ so the in-app
 * IDE works without GitHub credentials (optional PAT only for push-to-remote).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "bundled-workspace");
const FILES_ROOT = path.join(OUT, "root");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".cursor",
  ".vscode",
  "bundled-workspace",
]);

const SKIP_PREFIXES = ["public/bundled-workspace"];

function skipBinaryExtension(relPath) {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf|mp4|webm|svg)$/i.test(relPath);
}

function walk(dir, relBase = "") {
  /** @type {string[]} */
  const files = [];
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const d of dirents) {
    const rel = relBase ? `${relBase}/${d.name}` : d.name;
    if (SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name)) continue;
      files.push(...walk(path.join(dir, d.name), rel));
      continue;
    }
    if (!d.isFile()) continue;
    if (skipBinaryExtension(rel)) continue;
    const stat = fs.statSync(path.join(dir, d.name));
    if (stat.size > 900_000) continue;
    files.push(rel);
  }
  return files;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FILES_ROOT, { recursive: true });

const relFiles = walk(ROOT).sort((a, b) => a.localeCompare(b));

/** Drop noisy roots */
const filtered = relFiles.filter((rel) => {
  if (rel.startsWith("scripts/") && rel.endsWith(".mjs")) return false;
  return true;
});

for (const rel of filtered) {
  const src = path.join(ROOT, rel);
  const dest = path.join(FILES_ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const manifest = {
  paths: filtered,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 0), "utf8");

console.log(`bundled-workspace: ${filtered.length} files → public/bundled-workspace/`);
