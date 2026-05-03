import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react";
import {
  getEffectivePumpPortalApiKey,
  isPumpPortalPublicOnly,
} from "@/lib/pumpPortalConfig";

type Props = {
  mint: string | null;
  orderBookConn: "idle" | "connecting" | "open" | "closed" | "error";
  orderBookError: string | null;
  /** ms epoch of the last received trade for this mint, or null if none yet. */
  orderBookLastTradeAt: number | null;
};

const SILENT_WARN_MS = 60_000;
const SILENT_LOUD_MS = 180_000;

/**
 * Consolidated visible health indicator for the PumpPortal stream.
 * Always renders something so users immediately understand stream state.
 */
export function StreamHealthBanner({
  mint,
  orderBookConn,
  orderBookError,
  orderBookLastTradeAt,
}: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  if (!mint) return null;

  const apiKey = getEffectivePumpPortalApiKey().trim();
  const publicOnly = isPumpPortalPublicOnly();

  if (!apiKey && !publicOnly) {
    return (
      <Banner tone="error" icon={<AlertCircle className="size-3.5" strokeWidth={2} />}>
        No PumpPortal API key. The order-book stream and trading need one — add it in Setup.
      </Banner>
    );
  }

  if (orderBookError) {
    const lower = orderBookError.toLowerCase();
    const looksRateLimit =
      lower.includes("rate") || lower.includes("limit") || lower.includes("quota") || lower.includes("429");
    const looksAuth =
      lower.includes("api key") || lower.includes("api-key") || lower.includes("auth") ||
      lower.includes("forbidden") || lower.includes("401") || lower.includes("403");
    return (
      <Banner tone="error" icon={<AlertCircle className="size-3.5" strokeWidth={2} />}>
        <span className="font-medium">
          {looksRateLimit
            ? "PumpPortal rate-limited"
            : looksAuth
              ? "PumpPortal rejected your key"
              : "PumpPortal error"}
          :
        </span>{" "}
        {orderBookError}
      </Banner>
    );
  }

  if (orderBookConn === "connecting" || orderBookConn === "idle") {
    return (
      <Banner tone="info" icon={<Loader2 className="size-3.5 animate-spin" strokeWidth={2} />}>
        Connecting to PumpPortal stream…
      </Banner>
    );
  }

  if (orderBookConn === "closed" || orderBookConn === "error") {
    return (
      <Banner tone="warn" icon={<WifiOff className="size-3.5" strokeWidth={2} />}>
        Stream disconnected — reconnecting automatically with backoff.
      </Banner>
    );
  }

  // Connection is open — check for silence
  if (orderBookConn === "open" && orderBookLastTradeAt != null) {
    const silentMs = now - orderBookLastTradeAt;
    if (silentMs > SILENT_LOUD_MS) {
      return (
        <Banner tone="warn" icon={<AlertTriangle className="size-3.5" strokeWidth={2} />}>
          No trades for {Math.round(silentMs / 60_000)}m. Token may have bonded to Raydium, the stream is stuck, or
          it's just quiet. Try a different mint to confirm.
        </Banner>
      );
    }
    if (silentMs > SILENT_WARN_MS) {
      return (
        <Banner tone="info" icon={<AlertTriangle className="size-3.5" strokeWidth={2} />}>
          Quiet for {Math.round(silentMs / 1000)}s — stream is open but no recent trades.
        </Banner>
      );
    }
  }

  if (orderBookConn === "open" && orderBookLastTradeAt == null) {
    return (
      <Banner tone="info" icon={<Loader2 className="size-3.5 animate-spin" strokeWidth={2} />}>
        Subscribed — waiting for the first trade frame…
      </Banner>
    );
  }

  return (
    <Banner tone="ok" icon={<CheckCircle2 className="size-3.5" strokeWidth={2} />}>
      Live streaming
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "info" | "warn" | "error";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-400/90"
      : tone === "info"
        ? "border-[#2EA8FF]/25 bg-[#2EA8FF]/[0.05] text-[#2EA8FF]/90"
        : tone === "warn"
          ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-400/95"
          : "border-red-500/30 bg-red-500/[0.06] text-red-400/95";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px] leading-snug ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
