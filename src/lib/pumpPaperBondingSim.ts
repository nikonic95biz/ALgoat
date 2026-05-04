/**
 * Paper-wallet SOL estimate using pump-style constant-product bonding math.
 * @see https://github.com/nirholas/pump-fun-sdk/blob/main/docs/bonding-curve-math.md
 *
 * Uses entry / exit **tape snapshots** of virtual reserves — ignores other traders between
 * fills, so this is a grounded approximation, not a replay of chain execution.
 */

export type BondingSnapshot = {
  virtualSolLamports: bigint;
  virtualTokenRaw: bigint;
  realTokenRaw: bigint;
};

function toLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol <= 0) return 0n;
  return BigInt(Math.round(sol * 1e9));
}

export function fromLamports(lam: bigint): number {
  return Number(lam) / 1e9;
}

/** Heuristic: WS/API sometimes ships SOL as float, sometimes lamports. */
export function normalizeSolToLamports(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n;
  if (n >= 1e11) return BigInt(Math.round(n));
  return toLamports(n);
}

/**
 * Rough combined protocol+creator fee (bps) for paper — real tiers vary by MC.
 * Keeps estimates conservative vs pretending fees don’t exist.
 */
const DEFAULT_FEE_BPS = 125n;

/**
 * Simulate: spend `paperSol` SOL on the entry curve → tokens, then sell those tokens into the **exit** curve snapshot.
 */
export function simulatePumpPaperRoundTripSol(
  entry: BondingSnapshot,
  exit: BondingSnapshot,
  paperSol: number,
  feeBps: bigint = DEFAULT_FEE_BPS,
): { solSpent: number; solReceived: number; netSol: number; roiPct: number } | null {
  try {
    const grossLamports = toLamports(paperSol);
    if (grossLamports <= 0n) return null;

    const vSol = entry.virtualSolLamports;
    const vTok = entry.virtualTokenRaw;
    const rTok = entry.realTokenRaw;
    if (vSol <= 0n || vTok <= 0n || rTok < 0n) return null;

    const feeMul = 10000n - feeBps;
    if (feeMul <= 0n || feeMul > 10000n) return null;

    const buyNetLamports = (grossLamports * feeMul) / 10000n;
    if (buyNetLamports <= 0n) return null;

    let tokensOut = (buyNetLamports * vTok) / (vSol + buyNetLamports);
    if (tokensOut <= 0n) return null;
    if (tokensOut > rTok) tokensOut = rTok;

    const vSolX = exit.virtualSolLamports;
    const vTokX = exit.virtualTokenRaw;
    if (vSolX <= 0n || vTokX <= 0n) return null;

    const solOutRaw = (tokensOut * vSolX) / (vTokX + tokensOut);
    if (solOutRaw <= 0n) return null;

    const solReceivedLamports = (solOutRaw * feeMul) / 10000n;

    const solSpent = paperSol;
    const solReceived = fromLamports(solReceivedLamports);
    const netSol = solReceived - solSpent;
    const roiPct = solSpent > 0 ? (netSol / solSpent) * 100 : 0;

    return { solSpent, solReceived, netSol, roiPct };
  } catch {
    return null;
  }
}

function parseNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseBigStr(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d+$/.test(t)) return BigInt(t);
  }
  return null;
}

/** Bonding curve reserves when PumpPortal / pump payloads include account fields. */
export function parseBondingSnapshotFromMsg(m: Record<string, unknown>): BondingSnapshot | null {
  const pickBig = (keys: string[]): bigint | null => {
    for (const k of keys) {
      const b = parseBigStr(m[k]);
      if (b != null && b > 0n) return b;
    }
    return null;
  };

  const vsol =
    pickBig(["virtualSolReserves", "virtual_sol_reserves"]) ??
    (() => {
      const n = parseNum(m.vSolInBondingCurve);
      const lam = normalizeSolToLamports(n);
      return lam > 0n ? lam : null;
    })();

  const vtok = pickBig(["virtualTokenReserves", "virtual_token_reserves"]);
  const rtok = pickBig(["realTokenReserves", "real_token_reserves"]) ?? 0n;

  if (vsol == null || vtok == null || vsol <= 0n || vtok <= 0n) return null;
  if (rtok < 0n) return null;

  return { virtualSolLamports: vsol, virtualTokenRaw: vtok, realTokenRaw: rtok };
}
