/** Compact USD for chart axis and order-book style columns (e.g. $12.4K, $1.02M). */
export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(2)}K`;
  if (v >= 1) return `${sign}$${v.toFixed(2)}`;
  if (v >= 0.01) return `${sign}$${v.toFixed(4)}`;
  return `${sign}$${v.toFixed(6)}`;
}

/** SOL with fixed decimals. */
export function formatSol(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/** MC column for order-book prints: `622.3K`, `1.02M` (no $). */
export function formatMcUsdBook(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `${sign}${v.toFixed(2)}`;
  return `${sign}${v.toFixed(4)}`;
}

/** Token amount column: `5.31M`, `3.74M`. */
export function formatTokenQtyBook(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(2)}K`;
  if (v >= 1) return `${sign}${v.toFixed(2)}`;
  if (v >= 0.0001) return `${sign}${v.toFixed(4)}`;
  return `${sign}${v.toExponential(2)}`;
}
