import { useCallback, useEffect, useState } from "react";
import type { WorkspaceTab } from "@/types";
import { FALLBACK_WORKSPACE_TAB_ID } from "@/types";
import {
  loadActiveWorkspaceTabId,
  loadWorkspaceTabs,
  saveActiveWorkspaceTabId,
  saveWorkspaceTabs,
} from "@/lib/workspaceTabsPersistence";

function normalizeActive(tabs: WorkspaceTab[], activeId: string): string {
  if (tabs.some((t) => t.id === activeId)) return activeId;
  return tabs[0]?.id ?? FALLBACK_WORKSPACE_TAB_ID;
}

export function useWorkspaceTabs() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => loadWorkspaceTabs());
  const [activeId, setActiveIdState] = useState(() => {
    const t = loadWorkspaceTabs();
    return normalizeActive(t, loadActiveWorkspaceTabId(FALLBACK_WORKSPACE_TAB_ID));
  });

  useEffect(() => {
    saveWorkspaceTabs(tabs);
  }, [tabs]);

  useEffect(() => {
    saveActiveWorkspaceTabId(activeId);
  }, [activeId]);

  useEffect(() => {
    const fixed = normalizeActive(tabs, activeId);
    if (fixed !== activeId) setActiveIdState(fixed);
  }, [tabs, activeId]);

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
  }, []);

  const setTabsAndValidate = useCallback((updater: (prev: WorkspaceTab[]) => WorkspaceTab[]) => {
    setTabs((prev) => updater(prev));
  }, []);

  return { tabs, setTabs: setTabsAndValidate, activeId, setActiveId };
}
