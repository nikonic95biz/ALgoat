import { useCallback, useEffect, useState } from "react";
import { LandingPage } from "@/components/LandingPage";
import { TradingWorkspace } from "@/components/TradingWorkspace";
import { AppProvider } from "@/context/AppContext";
import { homePath, isWorkspacePath, workspacePath } from "@/lib/siteUrls";

export default function App() {
  const [pathname, setPathname] = useState(
    () => (typeof window !== "undefined" ? window.location.pathname : "/"),
  );

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const openWorkspace = useCallback(() => {
    const next = workspacePath();
    window.history.pushState({}, "", next);
    setPathname(next);
  }, []);

  if (isWorkspacePath(pathname)) {
    return (
      <AppProvider>
        <TradingWorkspace />
      </AppProvider>
    );
  }

  return (
    <LandingPage homeHref={homePath()} workspaceHref={workspacePath()} onOpenWorkspace={openWorkspace} />
  );
}
