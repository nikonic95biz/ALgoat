import { useEffect, useState, useCallback } from "react";
import {
  isFileSystemAccessSupported,
  loadPersistedHandle,
  openLocalWorkspace,
  persistHandle,
  readLocalFile,
} from "@/lib/localWorkspace";

const REQUIRED_FILES = ["src/App.tsx", "src/context/AppContext.tsx", "package.json"];

async function validateFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
  for (const path of REQUIRED_FILES) {
    try { await readLocalFile(handle, path); }
    catch { return false; }
  }
  return true;
}

type PermissionableHandle = FileSystemDirectoryHandle & {
  queryPermission: (opts: { mode: string }) => Promise<PermissionState>;
  requestPermission: (opts: { mode: string }) => Promise<PermissionState>;
};

async function queryPerm(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (handle as PermissionableHandle).queryPermission({ mode: "readwrite" });
}

async function requestPerm(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const result = await (handle as PermissionableHandle).requestPermission({ mode: "readwrite" });
  return result === "granted";
}

type Status = "autoloading" | "resume" | "idle" | "picking" | "invalid";

export function ProjectGate({ onReady }: { onReady: (handle: FileSystemDirectoryHandle) => void }) {
  const [status, setStatus] = useState<Status>("autoloading");
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tryAutoRestore = useCallback(async () => {
    try {
      const handle = await loadPersistedHandle();
      if (!handle) { setStatus("idle"); return; }

      const perm = await queryPerm(handle);
      if (perm === "granted") {
        const valid = await validateFolder(handle);
        if (valid) { onReady(handle); return; }
      }

      setSavedHandle(handle);
      setStatus("resume");
    } catch {
      setStatus("idle");
    }
  }, [onReady]);

  useEffect(() => { void tryAutoRestore(); }, [tryAutoRestore]);

  async function handleResume() {
    if (!savedHandle) return;
    setErrorMsg(null);
    const granted = await requestPerm(savedHandle);
    if (!granted) {
      setStatus("resume");
      setErrorMsg("Permission was not granted. Click Resume session and approve folder access to enable chat file tools.");
      return;
    }
    const valid = await validateFolder(savedHandle);
    if (valid) {
      onReady(savedHandle);
    } else {
      setStatus("idle");
      setErrorMsg("Folder no longer looks like a SolClaw project.");
    }
  }

  async function handleOpen() {
    if (!isFileSystemAccessSupported()) {
      setErrorMsg("Folder access requires Chrome or Edge.");
      return;
    }
    setStatus("picking");
    setErrorMsg(null);
    try {
      const handle = await openLocalWorkspace();
      const valid = await validateFolder(handle);
      if (!valid) {
        setStatus(savedHandle ? "resume" : "idle");
        setErrorMsg("Not a SolClaw project - pick the root of your cloned repo.");
        return;
      }
      await persistHandle(handle);
      onReady(handle);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        setStatus(savedHandle ? "resume" : "idle");
        return;
      }
      setStatus(savedHandle ? "resume" : "idle");
      setErrorMsg("Could not open folder.");
    }
  }

  const busy = status === "autoloading" || status === "picking";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#08080f] px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 50% 44%, rgba(34,211,238,0.07) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <img
            src="/solclaw-logo.png"
            alt=""
            className="h-10 w-10 object-contain opacity-85"
            style={{ filter: "drop-shadow(0 0 16px rgba(34,211,238,0.3))", mixBlendMode: "screen" }}
          />
          <h1
            className="text-[28px] font-bold tracking-tight"
            style={{
              background: "linear-gradient(135deg, #99f6e4 0%, #67e8f9 40%, #c4b5fd 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            SolClaw
          </h1>
        </div>

        {status === "autoloading" ? (
          <div className="flex items-center gap-2 text-[12px] text-[rgba(255,255,255,0.3)]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border border-cyan-400/20 border-t-cyan-400/70" />
            Restoring session...
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {status === "resume" && (
              <button
                type="button"
                onClick={() => void handleResume()}
                className="flex items-center gap-2.5 rounded-xl px-6 py-3 text-[14px] font-semibold transition-all"
                style={{
                  background: "linear-gradient(135deg, rgba(34,211,238,0.16) 0%, rgba(139,92,246,0.10) 100%)",
                  border: "1px solid rgba(34,211,238,0.35)",
                  color: "rgba(255,255,255,0.92)",
                  boxShadow: "0 0 0 0 rgba(34,211,238,0)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 24px -4px rgba(34,211,238,0.35)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 0 0 rgba(34,211,238,0)"; }}
              >
                Resume session
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleOpen()}
              className="flex items-center gap-2.5 rounded-xl px-6 py-3 text-[14px] font-semibold transition-all"
              style={{
                background: status === "resume"
                  ? "rgba(255,255,255,0.04)"
                  : "linear-gradient(135deg, rgba(34,211,238,0.12) 0%, rgba(139,92,246,0.08) 100%)",
                border: status === "resume"
                  ? "1px solid rgba(255,255,255,0.10)"
                  : "1px solid rgba(34,211,238,0.22)",
                color: status === "resume" ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)",
              }}
            >
              {status === "picking" ? "Picking folder..." : "Open project"}
            </button>

            {errorMsg && (
              <p className="max-w-xs text-center text-[12px]" style={{ color: "rgba(252,165,165,0.8)" }}>
                {errorMsg}
              </p>
            )}

            {status === "resume" && !errorMsg ? (
              <p className="max-w-xs text-center text-[11px] text-[rgba(255,255,255,0.24)]">
                Browser permission is required after refresh before chat can read or write files.
              </p>
            ) : status !== "resume" ? (
              <p className="text-center text-[11px] text-[rgba(255,255,255,0.18)]">
                Select your local SolClaw repo folder
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
