#!/usr/bin/env node
/**
 * SolClaw CLI — bin/solclaw.mjs
 *
 * Usage:
 *   solclaw start          Start dev server + file API + typecheck watcher
 *   solclaw start --no-tc  Skip typecheck watcher
 *   solclaw --help
 */

import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const cmd = args[0];
const noTypecheck = args.includes("--no-tc");

const CYAN  = "\x1b[36m";
const GREEN = "\x1b[32m";
const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";

function banner() {
  console.log(`\n${CYAN}${BOLD}  SolClaw${RESET}  — Solana meme-coin trading terminal\n`);
}

function findRepoRoot() {
  // Walk up from cwd until we find package.json with solclaw-related name or vite.config.ts
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "vite.config.ts")) && existsSync(join(dir, "src"))) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

async function startCommand() {
  banner();

  const repoRoot = findRepoRoot();
  console.log(`  ${GREEN}✓${RESET} Workspace: ${repoRoot}`);

  // Start file API server
  const { startFileApiServer } = await import("../server/fileApi.mjs");
  startFileApiServer(repoRoot);

  // Start typecheck watcher (unless --no-tc)
  if (!noTypecheck) {
    const tscBin = join(repoRoot, "node_modules/.bin/tsc");
    if (existsSync(tscBin)) {
      const { startTypecheckWatcher } = await import("../server/typecheckWatcher.mjs");
      startTypecheckWatcher(repoRoot);
    } else {
      console.log("  ! TypeCheck:  tsc not found in node_modules, skipping (run npm install first)");
    }
  }

  // Run bundle-workspace script if present (same as predev hook)
  const bundleScript = join(repoRoot, "scripts/bundle-workspace.mjs");
  if (existsSync(bundleScript)) {
    await new Promise((resolve) => {
      const p = spawn("node", [bundleScript], { cwd: repoRoot, stdio: "inherit" });
      p.on("close", resolve);
    });
  }

  // Start Vite dev server
  const viteBin = join(repoRoot, "node_modules/.bin/vite");
  if (!existsSync(viteBin)) {
    console.error("\n  Error: Vite not found. Run `npm install` in the repo root first.\n");
    process.exit(1);
  }

  console.log(`  ${GREEN}✓${RESET} Starting:   Vite dev server\n`);

  const vite = spawn(viteBin, [], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  });

  vite.on("close", (code) => process.exit(code ?? 0));

  // Forward signals
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      vite.kill(sig);
      process.exit(0);
    });
  }
}

function helpCommand() {
  banner();
  console.log("  Commands:");
  console.log("    solclaw start          Start dev server + file API + typecheck watcher");
  console.log("    solclaw start --no-tc  Skip typecheck watcher");
  console.log("");
}

if (!cmd || cmd === "--help" || cmd === "-h") {
  helpCommand();
} else if (cmd === "start") {
  startCommand().catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error(`  Unknown command: ${cmd}. Run solclaw --help`);
  process.exit(1);
}
