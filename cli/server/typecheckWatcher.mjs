/**
 * SolClaw TypeScript error watcher
 *
 * Runs `tsc --noEmit --watch` in the repo root, parses the output,
 * and updates the shared latestTypecheckResult used by the file API.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTypecheckResult } from "./fileApi.mjs";

const TS_ERROR_RE = /^(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;

function parseTscOutput(lines) {
  const errors = [];
  for (const line of lines) {
    const m = TS_ERROR_RE.exec(line.trim());
    if (!m) continue;
    errors.push({
      file: m[1],
      line: parseInt(m[2], 10),
      col: parseInt(m[3], 10),
      code: m[4],
      message: m[5],
    });
  }
  return errors;
}

export function startTypecheckWatcher(repoRoot) {
  const root = resolve(repoRoot);
  const tscBin = resolve(root, "node_modules/.bin/tsc");

  console.log("  \u2713 TypeCheck:  watching for TS errors…");

  let buffer = [];
  let cycleActive = false;

  const proc = spawn(tscBin, ["--noEmit", "--watch", "--pretty", "false"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  function processBuffer() {
    const text = buffer.join("\n");
    buffer = [];

    if (text.includes("Found 0 errors")) {
      setTypecheckResult({ clean: true, errors: [], checkedAt: Date.now() });
      process.stdout.write("  \u2713 TypeCheck:  \u001b[32mclean\u001b[0m\n");
      return;
    }

    const lines = text.split("\n");
    const errors = parseTscOutput(lines);
    if (errors.length > 0) {
      setTypecheckResult({ clean: false, errors, checkedAt: Date.now() });
      process.stdout.write(`  \u26a0 TypeCheck:  \u001b[33m${errors.length} error(s)\u001b[0m\n`);
    }
  }

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.includes("Starting compilation in watch mode") || line.includes("File change detected")) {
        if (cycleActive) processBuffer();
        cycleActive = true;
        buffer = [];
        continue;
      }
      if (line.trim()) buffer.push(line);
      if (line.includes("Watching for file changes")) {
        processBuffer();
        cycleActive = false;
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    // tsc sometimes writes to stderr on first run
    buffer.push(chunk.toString());
  });

  proc.on("error", (err) => {
    console.warn("  TypeCheck watcher failed to start:", err.message);
  });

  return proc;
}
