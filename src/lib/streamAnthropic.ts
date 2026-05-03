/**
 * Anthropic Messages API SSE (`event:` + `data:` blocks, blank-line separated).
 * Handles text, extended-thinking (`thinking_delta`/`signature_delta`), and `ping` events.
 * @see https://platform.claude.com/docs/en/build-with-claude/streaming
 */

export type ConsumeAnthropicStreamOptions = {
  signal?: AbortSignal;
  /**
   * Abort if NO chunk arrives for this long (ms).
   * Anthropic sends `ping` events during long reasoning — those reset the clock.
   * Default: 30_000 (30 s). Set 0 to disable.
   */
  idleMs?: number;
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

        if (type === "content_block_delta") {
          const delta = j.delta as Record<string, unknown> | undefined;
          if (!delta) continue;
          const dt = typeof delta.type === "string" ? delta.type : "";

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

        if (type === "message_delta") {
          const mdelta = j.delta as Record<string, unknown> | undefined;
          const stopReason = typeof mdelta?.stop_reason === "string" ? mdelta.stop_reason : "";
          if (/max_tokens|refusal/i.test(stopReason)) {
            onDelta(`\n\n*[Stopped: ${stopReason}]*\n`);
          }
        }
      }
    }
  } finally {
    await cleanup();
  }
}
