import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { fetchTokenMeta, type TokenMeta } from "@/lib/tokenMeta";

function fmt(n: number | null, opts?: { decimals?: number; prefix?: string }): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const prefix = opts?.prefix ?? "";
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n.toFixed(opts?.decimals ?? 2)}`;
}

export function TokenInfoBar({ mint }: { mint: string | null }) {
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mint) { setMeta(null); return; }
    setLoading(true);
    setMeta(null);
    fetchTokenMeta(mint).then((m) => {
      setMeta(m);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [mint]);

  if (!mint) return null;
  if (loading && !meta) return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] text-[var(--color-fg-dim)]">
      <span className="animate-pulse">Loading token info…</span>
    </div>
  );
  if (!meta) return null;

  const links: { label: string; href: string; short: string }[] = [];
  if (meta.dexUrl) links.push({ label: "DEX", href: meta.dexUrl, short: "DEX" });
  if (meta.twitter) links.push({ label: "Twitter", href: meta.twitter, short: "𝕏" });
  if (meta.telegram) links.push({ label: "Telegram", href: meta.telegram, short: "TG" });
  if (meta.website) links.push({ label: "Website", href: meta.website, short: "Web" });

  const pumpUrl = `https://pump.fun/${mint}`;
  links.push({ label: "Pump.fun", href: pumpUrl, short: "Pump" });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-1.5 text-[11px]">
      {/* Name + symbol */}
      <span className="font-semibold text-[var(--color-fg)]">
        {meta.name}
        <span className="ml-1 font-normal text-[var(--color-fg-dim)]">{meta.symbol}</span>
      </span>

      {/* Stats */}
      {meta.liquidityUsd != null && (
        <Stat label="liq" value={fmt(meta.liquidityUsd, { prefix: "$" }) ?? ""} />
      )}
      {meta.pumpMcUsd != null && (
        <Stat label="mc" value={fmt(meta.pumpMcUsd, { prefix: "$" }) ?? ""} />
      )}
      {meta.volumeUsd24h != null && (
        <Stat label="vol 24h" value={fmt(meta.volumeUsd24h, { prefix: "$" }) ?? ""} />
      )}
      {meta.priceUsd != null && (
        <Stat label="price" value={`$${meta.priceUsd < 0.0001 ? meta.priceUsd.toExponential(2) : meta.priceUsd.toPrecision(4)}`} />
      )}

      {/* Links */}
      <span className="ml-auto flex items-center gap-2">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={l.label}
            className="flex items-center gap-0.5 font-medium text-[var(--color-fg-muted)] hover:text-[#2EA8FF]"
          >
            {l.short}
            <ExternalLink className="size-2.5" strokeWidth={1.5} />
          </a>
        ))}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[var(--color-fg-dim)]">
      <span className="text-[var(--color-fg-muted)]">{label} </span>
      <span className="font-medium text-[var(--color-fg)]">{value}</span>
    </span>
  );
}
