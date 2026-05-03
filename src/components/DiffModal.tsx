import { DiffEditor } from "@monaco-editor/react";
import React from "react";
import { X } from "lucide-react";

type Props = {
  path: string;
  original: string;
  modified: string;
  onApply: () => void;
  onCancel: () => void;
};

export function DiffModal({ path, original, modified, onApply, onCancel }: Props) {
  const lang = langFromPath(path);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { onCancel(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { onApply(); return; }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--color-bg-sideBar)",
          border: "1px solid var(--color-border)",
          maxHeight: "88vh",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-[var(--color-fg-muted)]">Review changes</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-fg-dim)]">{path}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-[var(--color-fg-dim)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)]"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Column labels */}
        <div className="flex shrink-0 border-b border-[var(--color-border-subtle)]">
          <div className="flex-1 px-4 py-1.5 text-[11px] text-[var(--color-fg-dim)]">Current (GitHub)</div>
          <div className="flex-1 px-4 py-1.5 text-[11px] text-[var(--color-fg-dim)]">Proposed</div>
        </div>

        {/* Diff editor */}
        <div className="min-h-0 flex-1" style={{ height: "60vh" }}>
          <DiffEditor
            height="100%"
            theme="vs-dark"
            language={lang}
            original={original}
            modified={modified}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        </div>

        {/* Footer actions */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--color-border-subtle)] px-4 py-2 text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className="unt-btn-primary px-5 py-2 text-[13px] font-semibold"
          >
            Apply & commit <span className="ml-1 opacity-50 text-[11px]">⌘↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "css") return "css";
  if (ext === "html") return "html";
  return "plaintext";
}
