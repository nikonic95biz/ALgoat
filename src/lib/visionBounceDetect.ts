/**
 * Vision-based bounce zone detection.
 *
 * Renders an offscreen lightweight-charts candlestick chart from the raw
 * 1-second candle data (showing ALL candles, fully zoomed out), sends that
 * image to the user's configured LLM, and parses horizontal support levels
 * from the model's response.
 *
 * Called only on manual "Refresh bounce lines" to avoid burning API credits.
 */

import { CandlestickSeries, createChart } from "lightweight-charts";
import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import type { ModelSettings } from "@/types";
import { inferBackendIdFromBaseUrl } from "@/lib/llmBackends";
import { resolveLlmApiUrl } from "@/lib/llmDevProxy";

/** Picks the cheapest known vision-capable model for each provider. */
const VISION_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "google/gemini-2.0-flash-001",
  "google-ai-studio": "gemini-2.0-flash",
  xai: "grok-2-vision-1212",
};

function pickVisionModel(configured: string, backendId: string | null): string {
  const knownVision = [
    "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini",
    "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022",
    "claude-3-7-sonnet-20250219", "claude-sonnet-4-20250514",
    "gemini-2.0-flash", "gemini-1.5-pro",
    "grok-2-vision-1212",
    "google/gemini-2.0-flash-001", "anthropic/claude-3.5-haiku",
    "meta-llama/llama-4-scout", "meta-llama/llama-4-maverick",
  ];
  if (knownVision.some((m) => configured.includes(m.split("/").pop()!))) {
    return configured;
  }
  return (backendId ? VISION_MODELS[backendId] : null) ?? "gpt-4o-mini";
}

function fmtPrice(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.001) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

// ─── Offscreen chart rendering ───────────────────────────────────────────────

/**
 * Renders an offscreen candlestick chart showing ALL provided candles
 * (fitContent so nothing is cropped) and returns a base64 PNG string.
 */
async function renderOffscreenCandleChart(
  candles: CandlestickData<UTCTimestamp>[],
): Promise<string | null> {
  if (candles.length === 0) return null;

  const W = 960;
  const H = 560;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${W}px;height:${H}px;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(host);

  try {
    // createChart / CandlestickSeries are statically imported at top of file

    const chart = createChart(host, {
      width: W,
      height: H,
      layout: {
        background: { color: "#0d1117" },
        textColor: "#8b949e",
      },
      grid: {
        vertLines: { color: "#161b22" },
        horzLines: { color: "#161b22" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        secondsVisible: candles.length < 500,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3fb950",
      downColor: "#f85149",
      borderUpColor: "#3fb950",
      borderDownColor: "#f85149",
      wickUpColor: "#3fb950",
      wickDownColor: "#f85149",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(candles);
    // Zoom out to show every single candle
    chart.timeScale().fitContent();

    // Two animation frames for the chart to fully paint
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const canvasEls = host.querySelectorAll("canvas");
    if (canvasEls.length === 0) { chart.remove(); return null; }

    // Composite all canvas layers into one image
    const offscreen = document.createElement("canvas");
    offscreen.width = W;
    offscreen.height = H;
    const ctx = offscreen.getContext("2d")!;
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    const hostRect = host.getBoundingClientRect();
    for (const canvas of canvasEls) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(r.left - hostRect.left);
      const y = Math.floor(r.top - hostRect.top);
      try {
        ctx.drawImage(canvas, x, y, Math.ceil(r.width), Math.ceil(r.height));
      } catch { /* tainted canvas layer — skip */ }
    }

    chart.remove();
    return offscreen.toDataURL("image/png").replace("data:image/png;base64,", "");
  } finally {
    if (document.body.contains(host)) document.body.removeChild(host);
  }
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const VISION_PROMPT = (
  yMin: number,
  yMax: number,
  currentPrice: number,
  candleCount: number,
) => `\
You are a crypto scalp trader analyzing a ${candleCount}-candle chart.
Current price RIGHT NOW: ${fmtPrice(currentPrice)}
Full chart range: ${fmtPrice(yMin)} (lowest wick) → ${fmtPrice(yMax)} (highest wick)

YOUR JOB: Find the FLOOR / BOUNCE SUPPORT levels — price areas BELOW the current price where buyers stepped in and pushed the price back UP.

A valid bounce zone looks like ONE of these patterns:
  A) PUMP → DIP ABSORBED: Price pumped up, then sold off and dipped to a low — and buyers absorbed that dip (price wicked down then reversed back up from that level). The wick LOW of that dip is the bounce zone.
  B) MULTI-TOUCH: The price visited the same price area 2 or more times and bounced each time (horizontal price floor, tested multiple times).
  C) STRUCTURAL SWING LOW: The absolute lowest point of a sell-off that preceded a significant recovery rally. Even if only touched once, if the bounce was large, it counts.
  D) RANGE BASE: A horizontal accumulation zone — price moved sideways at a low level before a pump. The bottom of that range is the support.

HARD RULES — NEVER VIOLATE:
  1. EVERY level you return MUST be AT LEAST 7% BELOW the current price of ${fmtPrice(currentPrice)}. The maximum allowed price is ${fmtPrice(currentPrice * 0.93)}. Do NOT return any price above that — not even 1% above that ceiling.
  2. Do NOT label current price consolidation or recent chop as support. Only label clear structural lows where price bounced significantly.
  3. Return only the 2-3 MOST OBVIOUS zones. Less is more. If in doubt, leave it out.
  4. Zones must be at least 15% apart from each other — one line per price region.
  5. Use the exact WICK LOW price of the bounce area, not the candle body.
  6. Do NOT label resistance zones, consolidation at highs, or prior peaks.

OUTPUT: Respond with ONLY a raw JSON array of numbers, sorted descending (highest support first).
No markdown. No text. No units. Just the JSON array.
Example: [${fmtPrice(currentPrice * 0.85)}, ${fmtPrice(currentPrice * 0.70)}, ${fmtPrice(currentPrice * 0.52)}]

Bounce support levels below ${fmtPrice(currentPrice)}:`;

// ─── Number parsing ───────────────────────────────────────────────────────────

function parseNumbersFromText(text: string): number[] {
  const match = text.match(/\[[\d.,\s]+\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]) as unknown[];
      return arr
        .map((v) => (typeof v === "number" ? v : parseFloat(String(v))))
        .filter((v) => Number.isFinite(v) && v > 0);
    } catch { /* fall through */ }
  }
  const nums = [...text.matchAll(/\b(\d[\d.,]*(?:e[+-]?\d+)?)\b/gi)]
    .map((m) => parseFloat(m[1]!.replace(/,/g, "")))
    .filter((v) => Number.isFinite(v) && v > 0);
  return nums;
}

// ─── Provider-specific callers ────────────────────────────────────────────────

async function callOpenAiCompatVision(
  imageBase64: string,
  model: ModelSettings,
  visionModel: string,
  prompt: string,
): Promise<number[]> {
  const url = resolveLlmApiUrl(`${model.baseUrl}/chat/completions`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: visionModel,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "high",
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vision API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return parseNumbersFromText(text);
}

async function callAnthropicVision(
  imageBase64: string,
  model: ModelSettings,
  visionModel: string,
  prompt: string,
): Promise<number[]> {
  const url = resolveLlmApiUrl(`${model.baseUrl}/messages`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: visionModel,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vision API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text: string }>;
  };
  const text = json.content?.find((c) => c.type === "text")?.text ?? "";
  return parseNumbersFromText(text);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type VisionDetectResult =
  | { ok: true; prices: number[]; modelUsed: string }
  | { ok: false; error: string };

/**
 * Render the full candle history as an offscreen chart, then ask the LLM
 * to identify key horizontal SUPPORT / BOUNCE price levels below current price.
 *
 * @param candles        Raw 1-second candle data — all of it, unfiltered
 * @param model          User's ModelSettings (API key, baseUrl, model name)
 * @param currentPrice   Live last price — used to hard-filter out any zones above it
 */
export async function detectBounceZonesVision(
  candles: CandlestickData<UTCTimestamp>[],
  model: ModelSettings,
  currentPrice?: number,
): Promise<VisionDetectResult> {
  if (!model.apiKey.trim()) {
    return { ok: false, error: "No LLM API key configured — add one in Setup." };
  }
  if (candles.length === 0) {
    return { ok: false, error: "No candle data available for vision analysis." };
  }

  const backendId = inferBackendIdFromBaseUrl(model.baseUrl);
  const visionModel = pickVisionModel(model.model, backendId);

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const yMin = Math.min(...lows);
  const yMax = Math.max(...highs);

  // If no live price provided, use the close of the last candle
  const livePx = currentPrice ?? candles[candles.length - 1]!.close;

  const imageBase64 = await renderOffscreenCandleChart(candles);
  if (!imageBase64) {
    return { ok: false, error: "Chart rendering failed (no canvas found)." };
  }

  const prompt = VISION_PROMPT(yMin, yMax, livePx, candles.length);

  try {
    let prices: number[];
    if (backendId === "anthropic") {
      prices = await callAnthropicVision(imageBase64, model, visionModel, prompt);
    } else {
      prices = await callOpenAiCompatVision(imageBase64, model, visionModel, prompt);
    }

    // Hard guardrails:
    // 1. Must be at least 7 % below current price — zones right at/near current price are noise.
    // 2. Must be above the absolute lowest wick (sanity floor).
    // 3. Must be a real positive number inside the chart range.
    const maxAllowed = livePx * 0.93; // at least 7 % below live price
    const minAllowed = yMin * 0.5;    // no more than 50 % below the chart floor
    const filtered = prices.filter((p) => p > 0 && p <= maxAllowed && p >= minAllowed);

    return { ok: true, prices: filtered, modelUsed: visionModel };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Vision API call failed",
    };
  }
}
