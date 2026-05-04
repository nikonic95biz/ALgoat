import { useCallback, useEffect, useState } from "react";
import { LandingPage } from "@/components/LandingPage";
import { TradingWorkspace } from "@/components/TradingWorkspace";
import { AppProvider } from "@/context/AppContext";
import { ReleaseNotesPage } from "@/components/ReleaseNotesPage";
import { changelogPath, homePath, isChangelogPath, isWorkspacePath, workspacePath } from "@/lib/siteUrls";

function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".local");
}

export default function App() {
  const [pathname, setPathname] = useState(() => {
    if (typeof window === "undefined") return "/";
    // When running locally (fork / npm run dev) skip the landing page entirely
    if (isLocalhost() && !isWorkspacePath(window.location.pathname)) {
      const wp = workspacePath();
      window.history.replaceState({}, "", wp);
      return wp;
    }
    return window.location.pathname;
  });

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

  if (isChangelogPath(pathname)) {
    return (
      <ReleaseNotesPage
        homeHref={homePath()}
        workspaceHref={workspacePath()}
        changelogHref={changelogPath()}
        onOpenWorkspace={openWorkspace}
      />
    );
  }

  return (
    <LandingPage
      homeHref={homePath()}
      workspaceHref={workspacePath()}
      changelogHref={changelogPath()}
      onOpenWorkspace={openWorkspace}
    />
  );
}
