import type { PumpPortalLiveRow } from "@/hooks/usePumpPortalTrades";

export type DepthLevel = {
  kind: "mc" | "sol";
  /** MC USD (kind mc) or SOL size bucket center (kind sol). */
  value: number;
  sol: number;
  count: number;
};

function mcBin(mc: number): number {
  if (!Number.isFinite(mc) || mc <= 0) return 0;
  const step = Math.max(mc * 0.0025, 50);
  return Math.round(mc / step) * step;
}

function solSizeBin(sol: number): number {
  if (!Number.isFinite(sol) || sol <= 0) return 0;
  const s = Math.round(sol * 100) / 100;
  return Math.max(0.01, s);
}

type Agg = { sol: number; count: number; kind: "mc" | "sol"; value: number };

/** Minimum weight so a print still creates a visible level when the stream omits SOL / MC. */
const FALLBACK_SOL_PRINT = 0.02;

function buildSide(rows: PumpPortalLiveRow[], buy: boolean, maxLevels: number): DepthLevel[] {
  const sideRows = rows.filter((r) => r.buy === buy);
  const map = new Map<string, Agg>();

  for (const r of sideRows) {
    const solW =
      r.sol > 0 && Number.isFinite(r.sol) ? r.sol : FALLBACK_SOL_PRINT;
    const mc = r.mcUsd;

    if (mc != null && Number.isFinite(mc) && mc > 0) {
      const b = mcBin(mc);
      if (b <= 0) continue;
      const key = `m:${b}`;
      const prev = map.get(key) ?? { sol: 0, count: 0, kind: "mc" as const, value: b };
      prev.sol += solW;
      prev.count += 1;
      map.set(key, prev);
    } else {
      const sb = solSizeBin(solW);
      if (sb <= 0) continue;
      const key = `s:${sb}`;
      const prev = map.get(key) ?? { sol: 0, count: 0, kind: "sol" as const, value: sb };
      prev.sol += solW;
      prev.count += 1;
      map.set(key, prev);
    }
  }

  const levels: DepthLevel[] = [...map.values()].map((v) => ({
    kind: v.kind,
    value: v.value,
    sol: v.sol,
    count: v.count,
  }));

  if (buy) {
    levels.sort((a, b) => b.value - a.value);
  } else {
    levels.sort((a, b) => a.value - b.value);
  }

  return levels.slice(0, maxLevels);
}

/**
 * Synthetic depth from recent trades (PumpPortal has no resting L2 stream).
 */
export function tradesToDepthSides(
  rows: PumpPortalLiveRow[],
  opts?: { maxLevels?: number },
): { bids: DepthLevel[]; asks: DepthLevel[] } {
  const maxLevels = opts?.maxLevels ?? 16;
  return {
    bids: buildSide(rows, true, maxLevels),
    asks: buildSide(rows, false, maxLevels),
  };
}
