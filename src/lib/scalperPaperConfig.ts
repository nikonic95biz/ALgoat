/**
 * Single source of truth for the built-in Scalper **paper** sim.
 * Paper scalper behavior — used when Order-book scalper is selected and a session is started (`BUILTIN_SCALPER_PRESET_ID`).
 */
export const SCALPER_PAPER_CONFIG = {
  /**
   * Entry only when MC is **strictly more** than this % below the reference peak
   * (peak resets after each closed trade — see `reduceScalperPaper`).
   */
  dipMinPct: 10,
  /** Catalyst buy must be **strictly larger** than this SOL notional. */
  catalystMinSol: 0.3,
  /** Take profit when MC is at or above entry * (1 + this / 100). */
  takeProfitPct: 10,
  /**
   * Order-book stop: sells with known SOL below this are ignored (dust).
   * Sells with SOL 0 / unknown still stop out (conservative).
   */
  minOrderBookSellSolForStop: 0.15,
  /** After a close, ignore new entries for this long (ms on trade timestamps). */
  reentryCooldownMs: 2500,

  /**
   * Live mode sends real txs via PumpPortal Lightning API (`/api/trade`) using the wallet tied to your API key.
   * Amount is SOL per entry signal; exits sell `100%` of the token balance (API semantics).
   */
  realBuySol: 0.05,
  realSlippagePct: 18,
  realPriorityFeeSol: 0.00006,
  /** `auto` lets PumpPortal route pump / pump-amm / raydium etc. */
  realPool: "auto" as const,
} as const;

export type ScalperPaperConfig = typeof SCALPER_PAPER_CONFIG;
