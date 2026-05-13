import { useState } from "react";
import { BrowserVerifier } from "@/components/BrowserVerifier";
import { ProjectGate } from "@/components/ProjectGate";
import { TradingWorkspace } from "@/components/TradingWorkspace";
import { AppProvider } from "@/context/AppContext";

export default function App() {
  const [workspaceHandle, setWorkspaceHandle] = useState<FileSystemDirectoryHandle | null>(null);

  if (!workspaceHandle) {
    return (
      <>
        <BrowserVerifier />
        <ProjectGate onReady={setWorkspaceHandle} />
      </>
    );
  }

  return (
    <AppProvider initialWorkspaceHandle={workspaceHandle}>
      <BrowserVerifier />
      <TradingWorkspace />
    </AppProvider>
  );
}
