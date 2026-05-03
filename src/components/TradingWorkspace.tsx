import { AppShell } from "@/components/AppShell";
import { AppTopChrome } from "@/components/AppTopChrome";

export function TradingWorkspace() {
  return (
    <div className="flex h-full min-h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--color-bg-editor)]">
      <AppTopChrome />
      <AppShell />
    </div>
  );
}
