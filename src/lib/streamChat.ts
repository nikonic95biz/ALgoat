/** OpenAI-style SSE (`data: {...}\\n`) from /chat/completions with `stream: true`. */
export async function consumeChatCompletionStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (chunk: string) => void,
): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const piece =
            json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
          if (piece) onDelta(piece);
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
