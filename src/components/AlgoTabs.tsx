import { useState, type ReactNode } from "react";

export type AlgoTab = "trading" | "lab" | "performance";

const TABS: { id: AlgoTab; label: string }[] = [
  { id: "trading", label: "Trading" },
  { id: "lab", label: "Algo Lab" },
  { id: "performance", label: "Performance" },
];

export function AlgoTabs({
  children,
  algoLabPanel,
  performancePanel,
  activeTab,
  onTabChange,
}: {
  children: ReactNode;
  algoLabPanel?: ReactNode;
  performancePanel?: ReactNode;
  activeTab?: AlgoTab;
  onTabChange?: (tab: AlgoTab) => void;
}) {
  const [localTab, setLocalTab] = useState<AlgoTab>("trading");
  const tab = activeTab ?? localTab;
  const setTab = (next: AlgoTab) => {
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-[var(--color-border-subtle)]">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              "px-4 py-2 text-xs font-medium transition-colors " +
              (tab === id
                ? "border-b-2 border-blue-400 text-blue-400"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "trading"
          ? children
          : tab === "lab"
            ? algoLabPanel
            : performancePanel}
      </div>
    </div>
  );
}
