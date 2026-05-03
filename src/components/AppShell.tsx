import { useLayoutEffect, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChatPanel } from "@/components/ChatPanel";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { DashboardViewport } from "@/components/DashboardViewport";
import { useApp } from "@/context/AppContext";

function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-px flex items-stretch justify-center bg-[var(--color-border)] hover:bg-[var(--color-fg-dim)] transition-colors duration-150">
      <span className="absolute inset-y-0 w-1" aria-hidden />
    </PanelResizeHandle>
  );
}

export function AppShell() {
  const { sidebarOpen } = useApp();
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  /** Keep one stable panel tree + storage key; collapsing avoids remount/layout resets when hiding the sidebar. */
  useLayoutEffect(() => {
    const p = sidebarPanelRef.current;
    if (!p) return;
    if (sidebarOpen) {
      try {
        p.expand(16);
      } catch {
        /* ignore */
      }
    } else {
      try {
        p.collapse();
      } catch {
        /* ignore */
      }
    }
  }, [sidebarOpen]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <PanelGroup
        direction="horizontal"
        className="min-h-0 min-w-0 flex-1"
        autoSaveId="unt-shell-layout-v2"
      >
        <Panel
          ref={sidebarPanelRef}
          id="dashboard-sidebar"
          order={1}
          defaultSize={24}
          minSize={16}
          maxSize={42}
          collapsible
          collapsedSize={0}
          className="min-w-0 overflow-hidden"
        >
          <DashboardSidebar />
        </Panel>
        <ResizeHandle />
        <Panel id="dashboard-viewport" order={2} defaultSize={46} minSize={22} className="min-w-0">
          <DashboardViewport />
        </Panel>
        <ResizeHandle />
        <Panel id="chat-panel" order={3} defaultSize={30} minSize={18} className="min-w-0">
          <ChatPanel />
        </Panel>
      </PanelGroup>
    </div>
  );
}
