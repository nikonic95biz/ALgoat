import type { WorkspaceTab } from "@/types";

type Props = {
  tabs: WorkspaceTab[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function WorkspaceTabBar({ tabs, activeId, onSelect }: Props) {
  return (
    <div
      className="flex min-h-[44px] shrink-0 items-end gap-1 overflow-x-auto px-2 pt-2"
      style={{ background: "var(--color-bg-editor)" }}
      role="tablist"
      aria-label="Workspace editors"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={"workspace-tab-" + tab.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            title={tab.id}
            className={
              "relative max-w-[180px] shrink-0 rounded-t-xl px-4 py-2.5 text-[14px] outline-none transition-colors " +
              (active
                ? "bg-[var(--color-bg-sideBar)] font-semibold text-[var(--color-fg-heading)]"
                : "font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)]")
            }
          >
            <span className="truncate tabular-nums">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
