/**
 * End-to-end chat test.
 * Run: node scripts/test-chat.mjs [anthropic-api-key]
 *
 * Without a key: runs SSE parser unit tests only.
 * With a key:    also calls the real Anthropic API via the dev proxy and verifies streaming.
 */

import { TextEncoder, TextDecoder } from "node:util";
import http from "node:http";

// ── Polyfill window.setTimeout for the parser (Node already has globalThis.setTimeout) ──
if (typeof globalThis.window === "undefined") {
  globalThis.window = { setTimeout, clearTimeout };
}

// ── Inline the parser (copy of streamAnthropic.ts logic translated to plain JS) ──────────
async function consumeAnthropicMessageStream(body, onDelta, opts = {}) {
  if (!body) return;
  const idleMs = opts.idleMs ?? 30_000;
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let reasoningOpen = false;

  async function cleanup() {
    try { await reader.cancel(); } catch { }
    try { reader.releaseLock(); } catch { }
  }

  try {
    while (true) {
      if (opts.signal?.aborted) { await cleanup(); return; }

      let stallId;
      const rawRead = reader.read();
      const stallRace = idleMs > 0
        ? new Promise((_, reject) => {
            stallId = globalThis.window.setTimeout(
              () => reject(new Error(`Stream stalled — no data for ${idleMs / 1000}s`)),
              idleMs,
            );
          })
        : rawRead;

      let chunk;
      try {
        chunk = idleMs > 0 ? await Promise.race([rawRead, stallRace]) : await rawRead;
      } finally {
        if (stallId !== undefined) globalThis.window.clearTimeout(stallId);
      }

      const { done, value } = chunk;
      if (done) break;

      buffer += dec.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let eventType = "";
        const dataParts = [];
        for (const line of rawBlock.split("\n")) {
          if (!line.trim() || line.startsWith(":")) continue;
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataParts.push(line.slice(5).trimStart());
        }
        if (dataParts.length === 0) continue;

        const dataStr = dataParts.join("").trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let j;
        try { j = JSON.parse(dataStr); } catch { continue; }

        const type = typeof j.type === "string" ? j.type : "";

        if (eventType === "error" || type === "error") {
          const msg = j.error?.message ?? j.error?.type ?? JSON.stringify(j.error ?? j);
          onDelta(`\n\n**API error:** ${msg}\n`);
          continue;
        }

        if (type === "ping") continue;

        if (type === "content_block_delta") {
          const delta = j.delta;
          const dt = typeof delta?.type === "string" ? delta.type : "";

          if (dt === "thinking_delta") {
            const thinking = typeof delta.thinking === "string" ? delta.thinking : "";
            if (thinking) {
              if (!reasoningOpen) { onDelta("*Thinking…* "); reasoningOpen = true; }
              onDelta(thinking);
            }
            continue;
          }
          if (dt === "signature_delta") {
            if (reasoningOpen) { onDelta("\n\n"); reasoningOpen = false; }
            continue;
          }
          if (dt === "text_delta") {
            const text = typeof delta.text === "string" ? delta.text : "";
            if (text) {
              if (reasoningOpen) { onDelta("\n\n"); reasoningOpen = false; }
              onDelta(text);
            }
            continue;
          }
        }

        if (type === "message_delta") {
          const stopReason = j.delta?.stop_reason ?? "";
          if (/max_tokens|refusal/i.test(stopReason)) onDelta(`\n\n*[Stopped: ${stopReason}]*\n`);
        }
      }
    }
  } finally {
    await cleanup();
  }
}

// ── Build a ReadableStream from raw SSE bytes ─────────────────────────────────────────────
function makeStream(events) {
  const enc = new TextEncoder();
  const lines = events.join("\n\n") + "\n\n";
  const bytes = enc.encode(lines);
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) { controller.close(); return; }
      // Deliver in small chunks to simulate real network
      const end = Math.min(pos + 64, bytes.length);
      controller.enqueue(bytes.slice(pos, end));
      pos = end;
    },
  });
}

// ── Unit tests ────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌  ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log("\n══ SSE parser unit tests ══\n");

await test("plain text_delta", async () => {
  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"x","type":"message"}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello, "}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world!"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];
  let acc = "";
  await consumeAnthropicMessageStream(makeStream(events), c => { acc += c; });
  assert(acc === "Hello, world!", `Expected "Hello, world!" got "${acc}"`);
});

await test("thinking_delta followed by text_delta", async () => {
  const events = [
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I should say hi."}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"abc123"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi there!"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];
  let acc = "";
  await consumeAnthropicMessageStream(makeStream(events), c => { acc += c; });
  assert(acc.includes("Hi there!"), `Should include "Hi there!" — got: "${acc}"`);
  assert(acc.includes("Thinking"), `Should show thinking prefix — got: "${acc}"`);
});

await test("ping events are ignored", async () => {
  const events = [
    'event: ping\ndata: {"type":"ping"}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"pong"}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];
  let acc = "";
  await consumeAnthropicMessageStream(makeStream(events), c => { acc += c; });
  assert(acc === "pong", `Expected "pong" got "${acc}"`);
});

await test("error event surfaced in output", async () => {
  const events = [
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  ];
  let acc = "";
  await consumeAnthropicMessageStream(makeStream(events), c => { acc += c; });
  assert(acc.includes("Overloaded"), `Should include error message — got: "${acc}"`);
});

await test("stall timeout fires and throws", async () => {
  // Stream that delivers one chunk then stalls forever
  const enc = new TextEncoder();
  const firstChunk = enc.encode('event: ping\ndata: {"type":"ping"}\n\n');
  let pulled = 0;
  const stallStream = new ReadableStream({
    pull(controller) {
      if (pulled === 0) { controller.enqueue(firstChunk); pulled++; }
      // After first chunk, never resolve (simulate hang)
    },
  });
  let threw = false;
  try {
    await consumeAnthropicMessageStream(stallStream, () => {}, { idleMs: 200 });
  } catch (e) {
    threw = true;
    assert(/stalled/i.test(e.message), `Expected stall error, got: "${e.message}"`);
  }
  assert(threw, "Should have thrown a stall error");
});

await test("AbortSignal cancels stream early", async () => {
  const events = [
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"B"}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
  ];
  const ac = new AbortController();
  let acc = "";
  // Abort before we start
  ac.abort();
  await consumeAnthropicMessageStream(makeStream(events), c => { acc += c; }, { signal: ac.signal });
  assert(acc === "", `Should produce no output after abort, got "${acc}"`);
});

await test("multi-chunk SSE block (bytes split mid-line)", async () => {
  // Deliver the SSE event split across two TCP chunks
  const enc = new TextEncoder();
  const full = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"split"}}\n\n';
  const midpoint = Math.floor(full.length / 2);
  const part1 = enc.encode(full.slice(0, midpoint));
  const part2 = enc.encode(full.slice(midpoint));
  let i = 0;
  const splitStream = new ReadableStream({
    pull(controller) {
      if (i === 0) { controller.enqueue(part1); }
      else if (i === 1) { controller.enqueue(part2); }
      else { controller.close(); }
      i++;
    },
  });
  let acc = "";
  await consumeAnthropicMessageStream(splitStream, c => { acc += c; });
  assert(acc === "split", `Expected "split" got "${acc}"`);
});

// ── Live proxy test (with real key) ──────────────────────────────────────────────────────
const apiKey = process.argv[2] ?? process.env.ANTHROPIC_API_KEY ?? "";

if (!apiKey) {
  console.log("\n══ Live API test skipped (no key) ══");
  console.log("   Pass a key as first arg: node scripts/test-chat.mjs sk-ant-...");
} else {
  console.log("\n══ Live API test (via dev proxy) ══\n");

  await test("real Anthropic streaming via proxy", async () => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 64,
      stream: true,
      messages: [{ role: "user", content: "Reply with exactly: CHAT_OK" }],
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: 5173,
        path: "/__proxy/llm/anthropic/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
          "anthropic-dangerous-direct-browser-access": "true",
        },
      }, resolve);
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
    const ct = response.headers["content-type"] ?? "";
    assert(ct.includes("text/event-stream"), `Expected SSE, got: ${ct}`);

    // Feed into a ReadableStream-compatible wrapper
    const chunks = [];
    await new Promise((resolve, reject) => {
      response.on("data", c => chunks.push(c));
      response.on("end", resolve);
      response.on("error", reject);
    });

    const raw = Buffer.concat(chunks).toString("utf8");
    console.log(`\n   Raw SSE (first 600 chars):\n${raw.slice(0, 600)}\n`);

    // Parse via our parser
    const enc = new TextEncoder();
    const bytes = enc.encode(raw);
    let pos = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (pos >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(pos, Math.min(pos + 64, bytes.length)));
        pos += 64;
      },
    });

    let acc = "";
    await consumeAnthropicMessageStream(stream, c => { acc += c; }, { idleMs: 0 });
    console.log(`   Parsed output: "${acc}"`);
    assert(acc.trim().length > 0, `Parser produced no output from a real response!`);
    assert(acc.includes("CHAT_OK"), `Expected CHAT_OK in response, got: "${acc}"`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────────────────
console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`);
if (failed > 0) process.exit(1);
