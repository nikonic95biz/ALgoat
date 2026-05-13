/**
 * Anthropic Messages API SSE (`event:` + `data:` blocks, blank-line separated).
 * Handles text, extended-thinking, tool_use content blocks, and `ping` events.
 * @see https://platform.claude.com/docs/en/build-with-claude/streaming
 */

import type { ToolCall } from "@/lib/agentTools";

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type ConsumeAnthropicStreamOptions = {
  signal?: AbortSignal;
  /**
   * Abort if NO chunk arrives for this long (ms).
   * Default: 30_000 (30 s). Set 0 to disable.
   */
  idleMs?: number;
  /** Called when a complete tool_use block is received. */
  onToolCall?: (call: ToolCall) => void;
  /** Called with the final stop_reason (e.g. "end_turn" | "tool_use"). */
  onStopReason?: (reason: string) => void;
  /** Called with token usage including prompt-cache stats. */
  onUsage?: (usage: AnthropicUsage) => void;
};

export async function consumeAnthropicMessageStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (chunk: string) => void,
  opts?: ConsumeAnthropicStreamOptions,
): Promise<void> {
  if (!body) return;
  const idleMs = opts?.idleMs ?? 30_000;
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let reasoningOpen = false;

  // Tool-use accumulation state
  type PartialToolCall = { id: string; name: string; inputJson: string };
  const toolBlocks = new Map<number, PartialToolCall>(); // index → partial call

  /** Cancel the reader without throwing (releaseLock requires no pending read). */
  async function cleanup() {
    try { await reader.cancel(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  try {
    while (true) {
      if (opts?.signal?.aborted) {
        await cleanup();
        return;
      }

      // Race each read against the idle stall timer
      let stallId: number | undefined;
      const rawRead = reader.read();
      const stallRace: Promise<ReadableStreamReadResult<Uint8Array>> =
        idleMs > 0
          ? new Promise<never>((_, reject) => {
              stallId = window.setTimeout(
                () => reject(new Error(`Stream stalled — no data for ${idleMs / 1000}s`)),
                idleMs,
              );
            })
          : rawRead;

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await (idleMs > 0 ? Promise.race([rawRead, stallRace]) : rawRead);
      } finally {
        if (stallId !== undefined) window.clearTimeout(stallId);
      }

      const { done, value } = chunk;
      if (done) break;

      buffer += dec.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawBlock = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let eventType = "";
        const dataParts: string[] = [];
        for (const line of rawBlock.split("\n")) {
          if (!line.trim() || line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataParts.push(line.slice(5).trimStart());
          }
        }
        if (dataParts.length === 0) continue;

        // Join multi-line data fields per SSE spec
        const dataStr = dataParts.join("").trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let j: Record<string, unknown>;
        try {
          j = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          continue; // ignore malformed chunks
        }

        const type = typeof j.type === "string" ? j.type : "";

        if (eventType === "error" || type === "error") {
          const err = j.error as { message?: string; type?: string } | undefined;
          const msg = err?.message ?? err?.type ?? JSON.stringify(j.error ?? j);
          onDelta(`\n\n**API error:** ${msg}\n`);
          continue;
        }

        if (type === "ping") continue;

        // ── Tool use: start collecting a tool block ────────────────────
        if (type === "content_block_start") {
          const block = j.content_block as Record<string, unknown> | undefined;
          const idx = typeof j.index === "number" ? j.index : -1;
          if (block?.type === "tool_use" && idx >= 0) {
            toolBlocks.set(idx, {
              id: typeof block.id === "string" ? block.id : "",
              name: typeof block.name === "string" ? block.name : "",
              inputJson: "",
            });
          }
          continue;
        }

        // ── Tool use: accumulate input JSON ────────────────────────────
        if (type === "content_block_stop") {
          const idx = typeof j.index === "number" ? j.index : -1;
          const partial = toolBlocks.get(idx);
          if (partial) {
            toolBlocks.delete(idx);
            try {
              const input = JSON.parse(partial.inputJson || "{}") as Record<string, unknown>;
              opts?.onToolCall?.({
                id: partial.id,
                name: partial.name as import("@/lib/agentTools").ToolName,
                input,
              });
            } catch { /* malformed tool JSON — skip */ }
          }
          continue;
        }

        if (type === "content_block_delta") {
          const delta = j.delta as Record<string, unknown> | undefined;
          if (!delta) continue;
          const dt = typeof delta.type === "string" ? delta.type : "";
          const idx = typeof j.index === "number" ? j.index : -1;

          // Accumulate tool input JSON
          if (dt === "input_json_delta") {
            const partial = toolBlocks.get(idx);
            if (partial) {
              partial.inputJson += typeof delta.partial_json === "string" ? delta.partial_json : "";
            }
            continue;
          }

          if (dt === "thinking_delta") {
            const thinking = typeof delta.thinking === "string" ? delta.thinking : "";
            if (thinking) {
              if (!reasoningOpen) {
                onDelta("*Thinking…* ");
                reasoningOpen = true;
              }
              onDelta(thinking);
            }
            continue;
          }

          if (dt === "signature_delta") {
            if (reasoningOpen) {
              onDelta("\n\n");
              reasoningOpen = false;
            }
            continue;
          }

          if (dt === "text_delta") {
            const text = typeof delta.text === "string" ? delta.text : "";
            if (text) {
              if (reasoningOpen) {
                onDelta("\n\n");
                reasoningOpen = false;
              }
              onDelta(text);
            }
            continue;
          }
        }

        if (type === "message_start") {
          const msg = j.message as { usage?: AnthropicUsage } | undefined;
          if (msg?.usage) opts?.onUsage?.(msg.usage);
          continue;
        }

        if (type === "message_delta") {
          const mdelta = j.delta as Record<string, unknown> | undefined;
          const stopReason = typeof mdelta?.stop_reason === "string" ? mdelta.stop_reason : "";
          if (stopReason) opts?.onStopReason?.(stopReason);
          if (/max_tokens|refusal/i.test(stopReason)) {
            onDelta(`\n\n*[Stopped: ${stopReason}]*\n`);
          }
          // Final usage update arrives in message_delta as well
          const usage = j.usage as AnthropicUsage | undefined;
          if (usage) opts?.onUsage?.(usage);
        }
      }
    }
  } finally {
    await cleanup();
  }
}
