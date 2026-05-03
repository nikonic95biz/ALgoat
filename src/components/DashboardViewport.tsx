import { CaChartPanel } from "@/components/CaChartPanel";
import { NurseryPanel } from "@/components/NurseryPanel";
import { WorkspaceTabBar } from "@/components/WorkspaceTabBar";
import { useApp } from "@/context/AppContext";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { DEFAULT_WORKSPACE_TABS } from "@/types";

const CHART_TAB_ID = DEFAULT_WORKSPACE_TABS[0]!.id;
const NURSERY_TAB_ID = DEFAULT_WORKSPACE_TABS[1]!.id;

export function DashboardViewport() {
  const { tabs, activeId, setActiveId } = useWorkspaceTabs();
  const { setCaMintInput } = useApp();

  function openTokenInChart(mint: string) {
    setCaMintInput(mint);
    setActiveId(CHART_TAB_ID);
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ background: "var(--color-bg-editor)" }}
    >
      <WorkspaceTabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} />

      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2" role="tabpanel">
        <WorkspaceSlot tabId={activeId} onOpenToken={openTokenInChart} />
      </div>
    </div>
  );
}

function WorkspaceSlot({
  tabId,
  onOpenToken,
}: {
  tabId: string;
  onOpenToken: (mint: string) => void;
}) {
  if (tabId === CHART_TAB_ID) return <CaChartPanel />;
  if (tabId === NURSERY_TAB_ID) return <NurseryPanel onOpenToken={onOpenToken} />;
  return <CaChartPanel />;
}
