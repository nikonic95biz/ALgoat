import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { ChevronRight, FileCode2, Folder, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { githubGetFileContent, githubListTextPaths, githubPutFileContent } from "@/lib/githubApi";

type TreeNode = {
  name: string;
  path: string;
  file: boolean;
  children: TreeNode[];
};

type TN = { name: string; fullPath: string; file: boolean; kids: Map<string, TN> };

function insertPath(root: TN, filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  let cur = root;
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]!;
    acc = acc ? `${acc}/${name}` : name;
    const isLast = i === parts.length - 1;
    let next = cur.kids.get(name);
    if (!next) {
      next = { name, fullPath: acc, file: isLast, kids: new Map() };
      cur.kids.set(name, next);
    } else if (isLast) {
      next.file = true;
      next.fullPath = filePath;
    }
    cur = next;
  }
}

function toTreeNodes(tn: TN): TreeNode[] {
  return [...tn.kids.values()]
    .map((n) => ({
      name: n.name,
      path: n.fullPath,
      file: n.file,
      children: toTreeNodes(n),
    }))
    .sort((a, b) => {
      if (a.file !== b.file) return a.file ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

function pathsToTree(paths: string[]): TreeNode[] {
  const root: TN = { name: "", fullPath: "", file: false, kids: new Map() };
  for (const p of paths) insertPath(root, p);
  return toTreeNodes(root);
}

function languageFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  return "plaintext";
}

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (folderPath: string) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const pad = 8 + depth * 12;
  if (node.file) {
    const sel = selectedPath === node.path;
    return (
      <button
        type="button"
        style={{ paddingLeft: pad }}
        className={
          "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left font-mono text-[12px] " +
          (sel
            ? "bg-[var(--color-fill-hover)] text-[var(--color-fg)]"
            : "text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)]")
        }
        onClick={() => onSelectFile(node.path)}
      >
        <FileCode2 className="size-3.5 shrink-0 opacity-70" strokeWidth={1.5} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
    );
  }

  const isOpen = expanded.has(node.path);
  return (
    <div className="min-w-0">
      <button
        type="button"
        style={{ paddingLeft: pad }}
        className="flex w-full items-center gap-0.5 rounded-md py-1 pr-2 text-left font-mono text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)]"
        onClick={() => toggle(node.path)}
      >
        <ChevronRight
          className={"size-3.5 shrink-0 transition-transform " + (isOpen ? "rotate-90" : "")}
          strokeWidth={1.5}
        />
        <Folder className="size-3.5 shrink-0 text-amber-400/80" strokeWidth={1.5} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {isOpen ? (
        <div>
          {node.children.map((c) => (
            <TreeRow
              key={c.path + (c.file ? ":f" : ":d")}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspacePanel() {
  const {
    githubWorkspace,
    setOpenFile,
    setWorkspaceFilePaths,
    applyEditTick,
    lastAppliedPath,
    setActivitySection,
    setSidebarMode,
    setSidebarOpen,
  } = useApp();
  const { token, owner, repo, branch } = githubWorkspace;
  const githubReady = Boolean(token.trim() && owner.trim() && repo.trim());
  const br = branch.trim() || "main";

  const [paths, setPaths] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [blobSha, setBlobSha] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => pathsToTree(paths), [paths]);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  const loadFile = useCallback(
    async (path: string) => {
      if (!githubReady) return;
      setFileLoading(true);
      setFileError(null);
      try {
        const { text, sha } = await githubGetFileContent(token, owner, repo, br, path);
        setEditorText(text);
        setSavedText(text);
        setBlobSha(sha);
        setCommitMsg(`Edit ${path}`);
        setCommitError(null);
        setCommitSuccess(false);
        setOpenFile(path, text);
      } catch (e) {
        setFileError(e instanceof Error ? e.message : String(e));
        setEditorText("");
        setSavedText("");
        setBlobSha(null);
        setOpenFile(path, null);
      } finally {
        setFileLoading(false);
      }
    },
    [token, owner, repo, br, githubReady, setOpenFile],
  );

  const refreshTree = useCallback(async () => {
    if (!githubReady) {
      setPaths([]);
      setWorkspaceFilePaths([]);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const list = await githubListTextPaths(token, owner, repo, br);
      setPaths(list);
      setWorkspaceFilePaths(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
      setPaths([]);
      setWorkspaceFilePaths([]);
    } finally {
      setListLoading(false);
    }
  }, [token, owner, repo, br, githubReady, setWorkspaceFilePaths]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    if (!selectedPath) {
      setEditorText("");
      setSavedText("");
      setBlobSha(null);
      setOpenFile(null, null);
      return;
    }
    void loadFile(selectedPath);
  }, [selectedPath, loadFile, setOpenFile]);

  /** Reload after chat applies an edit to the open file. */
  useEffect(() => {
    if (!applyEditTick || !lastAppliedPath) return;
    if (lastAppliedPath !== selectedPath) return;
    void loadFile(lastAppliedPath);
  // applyEditTick is the intentional trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyEditTick]);

  const dirty = selectedPath != null && blobSha != null && !fileLoading && editorText !== savedText;

  const handleCommit = async () => {
    if (!dirty || !blobSha || !selectedPath) return;
    const msg = commitMsg.trim() || `Edit ${selectedPath}`;
    setCommitting(true);
    setCommitError(null);
    setCommitSuccess(false);
    try {
      await githubPutFileContent({
        token,
        owner,
        repo,
        branch: br,
        path: selectedPath,
        message: msg,
        contentUtf8: editorText,
        sha: blobSha,
      });
      await loadFile(selectedPath);
      setCommitSuccess(true);
      setTimeout(() => setCommitSuccess(false), 3000);
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const repoLabel = githubReady ? `${owner}/${repo}` : null;

  /** Not connected — show setup prompt */
  if (!githubReady) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: "var(--color-bg-sideBar)" }}
      >
        <GitBranch className="size-8 text-[var(--color-fg-dim)]" strokeWidth={1.5} />
        <div className="max-w-sm">
          <p className="unt-section-title text-[14px]">Connect GitHub</p>
          <p className="unt-body-text mt-2">
            Add a GitHub PAT in Setup and click{" "}
            <span className="font-medium text-[var(--color-fg)]">Fork &amp; connect</span> to
            browse and edit your repo files from here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setActivitySection("models");
            setSidebarMode("models");
            setSidebarOpen(true);
          }}
          className="unt-btn-primary px-5 py-2 text-[13px]"
        >
          Open Setup
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
        {/* File tree */}
        <aside className="flex max-h-[40vh] min-h-[140px] w-full shrink-0 flex-col border-b border-[var(--color-border-subtle)] lg:max-h-none lg:h-full lg:w-[min(260px,36%)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="unt-strip-heading mb-1">Repository</div>
              <p className="truncate font-mono text-[11px] font-medium text-[var(--color-fg-heading)]">
                {repoLabel}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--color-fg-dim)]">
                Branch <span className="text-[var(--color-fg-muted)]">{br}</span>
              </p>
            </div>
            <button
              type="button"
              title="Refresh"
              disabled={listLoading}
              onClick={() => void refreshTree()}
              className="shrink-0 rounded-lg p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)] disabled:opacity-50"
            >
              {listLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" strokeWidth={1.5} />
              )}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {listError ? (
              <p className="px-1 text-[12px] leading-snug text-red-400/90">{listError}</p>
            ) : paths.length === 0 && !listLoading ? (
              <p className="px-1 text-[12px] text-[var(--color-fg-dim)]">No files loaded.</p>
            ) : (
              tree.map((n) => (
                <TreeRow
                  key={n.path + (n.file ? ":f" : ":d")}
                  node={n}
                  depth={0}
                  expanded={expanded}
                  toggle={toggleFolder}
                  selectedPath={selectedPath}
                  onSelectFile={(path) => {
                    if (dirty && !window.confirm(`You have unsaved changes in ${selectedPath}.\nDiscard and open ${path}?`)) return;
                    setSelectedPath(path);
                  }}
                />
              ))
            )}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2.5">
            <span className="unt-strip-heading shrink-0">File</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-fg-heading)]">
              {selectedPath ?? "Select a file"}
              {dirty ? <span className="text-amber-400/80"> ·  unsaved</span> : null}
            </span>
            {fileLoading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--color-fg-dim)]" /> : null}
          </div>

          {fileError ? (
            <p className="shrink-0 px-3 py-2 text-[12px] text-red-400/90">{fileError}</p>
          ) : null}

          <div className="relative min-h-[200px] flex-1">
            <Editor
              height="100%"
              theme="vs-dark"
              path={selectedPath ?? "untitled"}
              language={selectedPath ? languageFromPath(selectedPath) : "plaintext"}
              value={editorText}
              onChange={(v) => setEditorText(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                scrollBeyondLastLine: false,
                readOnly: !selectedPath || fileLoading || committing,
              }}
            />
          </div>

          {/* Commit bar */}
          <div className="shrink-0 space-y-2 border-t border-[var(--color-border-subtle)] px-3 py-3">
            <div className="unt-strip-heading px-0.5">Commit</div>
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message"
              disabled={!dirty || committing}
              className="unt-input w-full font-mono text-[12px]"
            />
            {commitError ? <p className="text-[12px] text-red-400/90">{commitError}</p> : null}
            {commitSuccess ? (
              <p className="text-[12px] text-emerald-400/80">Committed to GitHub ✓</p>
            ) : null}
            <button
              type="button"
              disabled={!dirty || committing || !blobSha}
              onClick={() => void handleCommit()}
              className="unt-btn-primary w-full py-2 text-[13px] font-medium disabled:opacity-50"
            >
              {committing ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Committing…
                </span>
              ) : (
                "Push to GitHub"
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
