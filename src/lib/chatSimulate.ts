/**
 * Fake streaming replies (no API) — UI testing only.
 * Off by default. Set `VITE_CHAT_SIMULATE=true` in `.env.local` to enable.
 */
export const CHAT_SIMULATE = import.meta.env.VITE_CHAT_SIMULATE === "true";

const BITS = [
  "zorp",
  "narf",
  "quibble",
  "fleep",
  "blorx",
  "wumpus",
  "greeble",
  "thonk",
  "plorp",
  "skree",
  "mungo",
  "vlex",
  "droob",
  "snazz",
  "frimp",
  "clorb",
  "yex",
  "pangle",
  "twip",
  "grunk",
];

function randomWord(): string {
  const base = BITS[Math.floor(Math.random() * BITS.length)]!;
  if (Math.random() > 0.65) return base + (Math.random() > 0.5 ? "ly" : "ify");
  return base + (Math.random() > 0.7 ? String(Math.floor(Math.random() * 99)) : "");
}

function buildWords(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(randomWord());
  return out;
}

export async function streamGibberishReply(
  assistantId: string,
  updateMessage: (id: string, patch: { content: string }) => void,
  options?: { wordCount?: number; wordsPerTick?: number; tickMs?: number },
): Promise<void> {
  const wordCount = options?.wordCount ?? 500;
  const wordsPerTick = options?.wordsPerTick ?? 7;
  const tickMs = options?.tickMs ?? 32;

  const words = buildWords(wordCount);
  let acc = "";

  for (let i = 0; i < words.length; i += wordsPerTick) {
    const chunk = words.slice(i, i + wordsPerTick).join(" ");
    acc = acc ? acc + " " + chunk : chunk;
    updateMessage(assistantId, { content: acc });
    await new Promise((r) => window.setTimeout(r, tickMs + Math.random() * 22));
  }
}
