#!/usr/bin/env node
/**
 * One-off PumpPortal websocket smoke test (does not ship secrets — pass key via env).
 *
 * Usage:
 *   PUMPPORTAL_API_KEY='your-key' node scripts/test-pumpportal-ws.mjs <mint>
 *
 * Example mint:
 *   node scripts/test-pumpportal-ws.mjs GBvoABT1MH7CogLm46JEy15h3qiKqnmgKZq69BTdpump
 */

const mint = process.argv[2]?.trim();
const key = process.env.PUMPPORTAL_API_KEY?.trim() ?? "";

if (!mint) {
  console.error("Usage: PUMPPORTAL_API_KEY='<key>' node scripts/test-pumpportal-ws.mjs <mint>");
  process.exit(1);
}

const url = key
  ? `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(key)}`
  : "wss://pumpportal.fun/api/data";

console.log("Mint:", mint);
console.log("WS:", key ? "wss://pumpportal.fun/api/data?api-key=(redacted)" : url);

let n = 0;
const ws = new WebSocket(url);

ws.addEventListener("open", () => {
  console.log("OPEN — subscribeTokenTrade");
  ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
});

ws.addEventListener("message", (ev) => {
  n++;
  const s = typeof ev.data === "string" ? ev.data : ev.data.toString();
  const preview = s.length > 2200 ? s.slice(0, 2200) + "…" : s;
  console.log(`\n--- #${n} (${s.length} chars) ---\n${preview}`);
  if (n >= 15) ws.close(1000, "done");
});

ws.addEventListener("error", (e) => console.error("ERROR:", e.message || String(e)));

ws.addEventListener("close", (ev) => {
  console.log("\nCLOSE code=", ev.code, ev.reason || "");
});

setTimeout(() => {
  console.log("\n15s timeout — closing");
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}, 15_000);
