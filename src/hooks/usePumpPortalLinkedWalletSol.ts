import { useCallback, useEffect, useState } from "react";
import { fetchNativeSolBalance } from "@/lib/solanaBalance";

export function usePumpPortalLinkedWalletSol(pubkey: string | null) {
  const [sol, setSol] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!pubkey?.trim()) {
      setSol(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const bal = await fetchNativeSolBalance(pubkey);
    setSol(bal);
    setLoading(false);
  }, [pubkey]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { sol, loading, refresh };
}
