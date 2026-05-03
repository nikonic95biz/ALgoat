/** Combine abort signals — abort `out` when any input aborts (carries through `reason`). */
export function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const out = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      out.abort(s.reason);
      return out.signal;
    }
    s.addEventListener("abort", () => out.abort(s.reason), { once: true });
  }
  return out.signal;
}
