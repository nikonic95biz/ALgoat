import type { WorkspaceTab } from "@/types";
import { DEFAULT_WORKSPACE_TABS } from "@/types";

const TABS_KEY = "unt_workspace_tabs_v1";
const ACTIVE_KEY = "unt_workspace_active_v1";

function mergeTabLabels(parsed: WorkspaceTab[]): WorkspaceTab[] {
  const defaults = new Map(DEFAULT_WORKSPACE_TABS.map((t) => [t.id, t.label]));
  return parsed.map((t) => {
    const label = defaults.get(t.id);
    return label !== undefined ? { ...t, label } : t;
  });
}

export function loadWorkspaceTabs(): WorkspaceTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return copyDefaultTabs();
    const parsed = JSON.parse(raw) as WorkspaceTab[];
    if (!Array.isArray(parsed) || parsed.length === 0) return copyDefaultTabs();

    const expectedIds = new Set(DEFAULT_WORKSPACE_TABS.map((t) => t.id));
    const sameLength = parsed.length === DEFAULT_WORKSPACE_TABS.length;
    const sameIds = sameLength && parsed.every((t) => expectedIds.has(t.id));
    if (!sameIds) return copyDefaultTabs();

    return mergeTabLabels(parsed);
  } catch {
    return copyDefaultTabs();
  }
}

function copyDefaultTabs(): WorkspaceTab[] {
  return [...DEFAULT_WORKSPACE_TABS];
}

export function saveWorkspaceTabs(tabs: WorkspaceTab[]): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
}

export function loadActiveWorkspaceTabId(fallback: string): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveActiveWorkspaceTabId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}
