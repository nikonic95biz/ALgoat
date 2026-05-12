import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  isValidElement,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleStop,
  Copy,
  ExternalLink,
  FilePen,
  ImagePlus,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp } from "@/context/AppContext";
import { buildComposerSystemPrompt } from "@/lib/composerSystemPrompt";
import { buildLiveContext } from "@/lib/buildChatContext";
import { parseChatEdits, parseAlgoBlocks, parseSuggestedFollowups, parseMintDirectives, parseConfigPatch } from "@/lib/parseChatEdits";
import { DiffModal } from "@/components/DiffModal";
import { CHAT_SIMULATE, streamGibberishReply } from "@/lib/chatSimulate";
import {
  browserLlmProxyEnabled,
  isOpenRouterBaseUrl,
  resolveChatCompletionUrl,
  resolveLlmApiUrl,
} from "@/lib/llmDevProxy";
import {
  ANTHROPIC_API_VERSION,
  anthropicMessagesUrl,
  buildAnthropicMessagesBody,
  isAnthropicMessagesApiBaseUrl,
} from "@/lib/llmAnthropic";
import { isLikelyLocalLlm, presetAllowsOptionalApiKey } from "@/lib/llmPresets";
import { wrongProviderKeyForOpenRouterHint } from "@/lib/openRouterKeyHints";
import { consumeAnthropicMessageStream } from "@/lib/streamAnthropic";
import { consumeChatCompletionStream } from "@/lib/streamChat";
import { mergeAbortSignals } from "@/lib/mergeAbortSignals";
import {
  githubGetFileContent,
  type WorkflowRunStatus,
} from "@/lib/githubApi";
import type { ChatMessage, ModelSettings } from "@/types";
import { ChatEmptyState } from "@/components/_ChatEmptyState";


// ─── Types ────────────────────────────────────────────────────────────────────

type ChatTurn = { user: ChatMessage; assistant?: ChatMessage };

type DiffState = {
  path: string;
  code: string;
  original: string;
} | null;

type CommitResult = {
  sha: string;
  paths: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupTurns(messages: ChatMessage[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const next = messages[i + 1];
    if (next?.role === "assistant") { out.push({ user: m, assistant: next }); i++; }
    else out.push({ user: m });
  }
  return out;
}

function flattenMarkdownText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenMarkdownText).join("");
  if (isValidElement(node)) return flattenMarkdownText((node.props as { children?: ReactNode }).children);
  return "";
}

/** Fenced blocks collapse tall snippets behind a header + chevron so replies don’t dominate the feed. */
function CollapsibleFence({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  let lang = "Code";
  if (isValidElement(children) && children.type === "code") {
    const p = children.props as { className?: string };
    const m = /language-([\w-]+)/.exec(p.className ?? "");
    if (m?.[1]) lang = m[1];
  }

  const raw = flattenMarkdownText(children).replace(/\n$/, "");
  const lineCount = raw ? raw.split("\n").length : 0;
  const sizable = lineCount > 5 || raw.length > 360;
  const expanded = open || !sizable;

  return (
    <div className="unt-chat-fence my-3 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[#0e0e0e]">
      <button
        type="button"
        onClick={() => sizable && setOpen((v) => !v)}
        disabled={!sizable}
        className={
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors " +
          (sizable
            ? "cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
            : "cursor-default opacity-90")
        }
        aria-expanded={expanded}
      >
        <ChevronRight
          strokeWidth={2}
          className={
            "size-3.5 shrink-0 text-[var(--color-fg-dim)] transition-transform duration-200 ease-out " +
            (expanded ? "rotate-90" : "rotate-0")
          }
        />
        <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
          {lang}
        </span>
        {lineCount > 0 ? (
          <span className="text-[11px] text-[var(--color-fg-dim)]">
            {lineCount} line{lineCount === 1 ? "" : "s"}
            {sizable ? (expanded ? "" : " · tap to expand") : ""}
          </span>
        ) : null}
      </button>
      <div
        className={
          "relative border-t border-[rgba(255,255,255,0.06)] px-3.5 py-3 " +
          (expanded ? "max-h-[min(70vh,560px)] overflow-auto" : "max-h-[5.25rem] overflow-hidden")
        }
      >
        {sizable && !expanded ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-12 bg-gradient-to-t from-[#0e0e0e] from-40% to-transparent"
            aria-hidden
          />
        ) : null}
        <pre className="unt-chat-fence-pre m-0">{children}</pre>
      </div>
    </div>
  );
}

function scrollTurnToTop(feed: HTMLDivElement, userMsgId: string, pad = 12): boolean {
  const section = feed.querySelector(`[data-chat-turn-id="${CSS.escape(userMsgId)}"]`) as HTMLElement | null;
  if (!section) return false;
  const maxScroll = () => Math.max(0, feed.scrollHeight - feed.clientHeight);
  let y = 0;
  let n: HTMLElement | null = section;
  while (n && n !== feed) { y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
  if (n === feed) feed.scrollTop = Math.max(0, Math.min(y - pad, maxScroll()));
  for (let k = 0; k < 32; k++) {
    const d = section.getBoundingClientRect().top - feed.getBoundingClientRect().top - pad;
    if (Math.abs(d) < 0.5) break;
    feed.scrollTop = Math.max(0, Math.min(feed.scrollTop + d, maxScroll()));
  }
  return true;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Prose({ content }: { content: string }) {
  return (
    <div className="chat-prose chat-prose-assistant pr-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <CollapsibleFence>{children}</CollapsibleFence>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MintLoadButtons({
  content,
  pending,
  onLoadMint,
}: {
  content: string;
  pending: boolean;
  onLoadMint: (mint: string) => void;
}) {
  const mints = useMemo(() => parseMintDirectives(content), [content]);
  if (pending || mints.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {mints.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onLoadMint(m)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-2.5 py-1.5 font-mono text-[11px] font-medium text-cyan-100/95 transition-colors hover:border-cyan-300/50 hover:bg-cyan-500/15"
        >
          <Rocket className="size-3 shrink-0" strokeWidth={1.5} />
          Load chart {m.slice(0, 4)}…{m.slice(-4)}
        </button>
      ))}
    </div>
  );
}

function ApplyButtons({
  content,
  pending,
  localWorkspaceConnected,
  onDiff,
  onApplyAll,
  onAddAlgo,
  onApplyConfig,
}: {
  content: string;
  pending: boolean;
  localWorkspaceConnected: boolean;
  onDiff: (path: string, code: string) => void;
  onApplyAll: (edits: { path: string; code: string }[]) => void;
  onAddAlgo: (name: string, description: string) => void;
  onApplyConfig: (patch: ReturnType<typeof parseConfigPatch>) => void;
}) {
  const edits = useMemo(() => parseChatEdits(content), [content]);
  const algos = useMemo(() => parseAlgoBlocks(content), [content]);
  const configPatch = useMemo(() => parseConfigPatch(content), [content]);

  if ((edits.length === 0 && algos.length === 0 && !configPatch) || pending) return null;

  const fileLabel = localWorkspaceConnected ? "Write locally" : "Apply";
  const fileCreateLabel = localWorkspaceConnected ? "Create locally" : "Create";

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {/* Config patch → live knob update */}
      {configPatch ? (
        <button
          type="button"
          onClick={() => onApplyConfig(configPatch)}
          title="Update live knob values instantly — no deploy needed"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#22d3ee_30%,transparent)] bg-[color-mix(in_srgb,#22d3ee_8%,transparent)] px-2.5 py-1.5 font-mono text-[11px] font-medium text-cyan-300/80 transition-colors hover:border-[color-mix(in_srgb,#22d3ee_50%,transparent)] hover:text-cyan-200"
        >
          <Check className="size-3 shrink-0" strokeWidth={2} />
          Apply to knobs
        </button>
      ) : null}
      {edits.length > 1 ? (
        <button
          type="button"
          onClick={() => onApplyAll(edits.map((e) => ({ path: e.path, code: e.code })))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sideBar)] px-2.5 py-1.5 font-mono text-[11px] font-medium text-[var(--color-fg-muted)] transition-colors hover:border-[rgba(255,255,255,0.15)] hover:text-[var(--color-fg)]"
        >
          <FilePen className="size-3 shrink-0" strokeWidth={1.5} />
          {fileLabel} all ({edits.length} files)
        </button>
      ) : null}
      {edits.map((edit, i) => (
        <button
          key={i}
          type="button"
          title={edit.isNew ? `Create new file: ${edit.path}` : `Preview & apply: ${edit.path}`}
          onClick={() => onDiff(edit.path, edit.code)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sideBar)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--color-fg-muted)] transition-colors hover:border-[rgba(255,255,255,0.15)] hover:text-[var(--color-fg)]"
        >
          <FilePen className="size-3 shrink-0" strokeWidth={1.5} />
          {edit.isNew ? fileCreateLabel : fileLabel} {edit.path}
        </button>
      ))}
      {algos.map((algo, i) => (
        <button
          key={`algo-${i}`}
          type="button"
          title={`Add "${algo.name}" to your algo dropdown`}
          onClick={() => onAddAlgo(algo.name, algo.description)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 font-mono text-[11px] text-emerald-400/80 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        >
          + Add algo: {algo.name}
        </button>
      ))}
    </div>
  );
}

function FollowupPills({ followups, onSend }: { followups: string[]; onSend: (text: string) => void }) {
  if (followups.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {followups.map((f, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSend(f)}
          className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-[rgba(255,255,255,0.12)] hover:text-[var(--color-fg-muted)]"
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function PostCommitRow({
  result,
  owner,
  repo,
  onDismiss,
}: {
  result: CommitResult;
  owner: string;
  repo: string;
  onDismiss: () => void;
}) {
  const commitUrl = `https://github.com/${owner}/${repo}/commit/${result.sha}`;
  const repoUrl = `https://github.com/${owner}/${repo}`;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[11.5px] text-[var(--color-fg-dim)]">
      <span className="text-emerald-400/80">✓ {result.paths.length === 1 ? result.paths[0] : `${result.paths.length} files`} committed</span>
      {result.sha ? (
        <a
          href={commitUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          View on GitHub <ExternalLink className="size-3" strokeWidth={1.5} />
        </a>
      ) : null}
      <a
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        title="Vercel auto-deploys when you push — connect your fork at vercel.com"
      >
        <Rocket className="size-3" strokeWidth={1.5} />
        Auto-deploys on push
      </a>
      <button type="button" onClick={onDismiss} className="ml-auto text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]">
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}

function ChatTurnSection({
  turn,
  isLatestTurn,
  pending,
  copiedId,
  commitResults,
  githubWorkspace,
  localWorkspaceConnected,
  onCopy,
  onDiff,
  onApplyAll,
  onAddAlgo,
  onApplyConfig,
  onSend,
  onDismissCommit,
  onLoadMint,
}: {
  turn: ChatTurn;
  isLatestTurn: boolean;
  pending: boolean;
  copiedId: string | null;
  commitResults: Map<string, CommitResult>;
  githubWorkspace: { token: string; owner: string; repo: string; branch: string };
  localWorkspaceConnected: boolean;
  onCopy: (id: string, content: string) => void;
  onDiff: (path: string, code: string) => void;
  onApplyAll: (edits: { path: string; code: string }[]) => void;
  onAddAlgo: (name: string, description: string) => void;
  onApplyConfig: (patch: ReturnType<typeof parseConfigPatch>) => void;
  onSend: (text: string) => void;
  onDismissCommit: (msgId: string) => void;
  onLoadMint: (mint: string) => void;
}) {
  const asst = turn.assistant;
  const commitResult = asst ? commitResults.get(asst.id) : undefined;

  const { followups, cleanContent } = useMemo(
    () => (asst ? parseSuggestedFollowups(asst.content) : { followups: [], cleanContent: "" }),
    [asst],
  );

  return (
    <section data-chat-turn-id={turn.user.id} className="shrink-0" style={{ scrollMarginTop: 12 }}>
      {/* User bubble */}
      <div className="mb-3 flex justify-end">
        <div
          className="max-w-[88%] rounded-2xl rounded-tr-sm px-3.5 py-2.5"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg)]">
          {turn.user.content}
        </p>
        </div>
      </div>

      {/* Assistant reply */}
        {asst ? (
          <div className="group/resp relative">
            {asst.content.length > 0 ? (
              <button
                type="button"
                title="Copy"
                onClick={() => void onCopy(asst.id, asst.content)}
              className="absolute right-0 top-0 z-[20] rounded-md p-1 text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] group-hover/resp:opacity-100"
            >
              {copiedId === asst.id ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={2} />}
              </button>
            ) : null}

          {asst.content.trim() === "" && pending && isLatestTurn ? (
            <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--color-fg-dim)]">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              <span>Connecting…</span>
              </div>
            ) : (
            <>
              <Prose content={cleanContent || asst.content} />
              <MintLoadButtons
                content={asst.content}
                pending={pending && isLatestTurn}
                onLoadMint={onLoadMint}
              />
              <ApplyButtons
                content={asst.content}
                pending={pending && isLatestTurn}
                localWorkspaceConnected={localWorkspaceConnected}
                onDiff={onDiff}
                onApplyAll={onApplyAll}
                onAddAlgo={onAddAlgo}
                onApplyConfig={onApplyConfig}
              />
              <FollowupPills followups={followups} onSend={onSend} />
              {commitResult ? (
                <PostCommitRow
                  result={commitResult}
                  owner={githubWorkspace.owner}
                  repo={githubWorkspace.repo}
                  onDismiss={() => onDismissCommit(asst.id)}
                />
              ) : null}
            </>
            )}
          </div>
        ) : pending && isLatestTurn ? (
        <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--color-fg-dim)]">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          <span>Connecting…</span>
          </div>
        ) : null}
    </section>
  );
}

function StandaloneAssistantIntro({ messages, copiedId, onCopy }: { messages: ChatMessage[]; copiedId: string | null; onCopy: (id: string, content: string) => void }) {
  if (messages.length === 0) return null;
  return (
    <div className="flex flex-col gap-4 pb-2">
      {messages.map((asst) => (
        <section key={asst.id} className="shrink-0">
          <div className="group/resp relative">
            <button
              type="button"
              title="Copy"
              onClick={() => void onCopy(asst.id, asst.content)}
              className="absolute right-0 top-0 z-[20] rounded-md p-1 text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] group-hover/resp:opacity-100"
            >
              {copiedId === asst.id ? <Check className="size-3.5" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={2} />}
            </button>
            <Prose content={asst.content || ""} />
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── @ mention picker ─────────────────────────────────────────────────────────

function AtMentionDropdown({
  query,
  paths,
  onSelect,
}: {
  query: string;
  paths: string[];
  onSelect: (path: string) => void;
}) {
  const q = query.toLowerCase();
  const matches = paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 8);
  if (matches.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-1 w-80 max-w-full overflow-hidden rounded-xl border border-[var(--color-border)] shadow-2xl"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      {matches.map((p) => (
        <button
          key={p}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(p); }}
          className="block w-full truncate px-3 py-2 text-left font-mono text-[11.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)]"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ─── Deploy status badge ──────────────────────────────────────────────────────

function DeployBadge({ run }: { run: WorkflowRunStatus | null | undefined }) {
  if (!run) return null;

  let color = "bg-[var(--color-fg-dim)]";
  let title = "Deploy: unknown";
  let animate = false;

  if (run.status === "in_progress" || run.status === "queued") {
    color = "bg-amber-400";
    title = "Deploy in progress…";
    animate = true;
  } else if (run.conclusion === "success") {
    color = "bg-emerald-400";
    title = "Last deploy: success";
  } else if (run.conclusion === "failure" || run.conclusion === "cancelled") {
    color = "bg-red-400";
    title = `Last deploy: ${run.conclusion}`;
  }

  return (
    <a
      href={run.html_url || undefined}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]"
    >
      <span className={`size-1.5 rounded-full ${color} ${animate ? "animate-pulse" : ""}`} />
      {run.status === "in_progress" || run.status === "queued" ? "deploying" : run.conclusion ?? ""}
    </a>
  );
}

// ─── Main ChatPanel ───────────────────────────────────────────────────────────

export function ChatPanel() {
  const {
    model: globalModel,
    chatSessions,
    activeChatId,
    setActiveChatId,
    newChatSession,
    closeChatSession,
    renameChatSession,
    clearSessionModel,
    messages,
    appendMessage,
    updateMessage,
    clearChat,
    setComposerBusy,
    openSetupPanel,
    navigateChartToMint,
    chartAnalytics,
    selectedAlgoId,
    userAlgos,
    tradingMode,
    openFilePath,
    openFileContent,
    workspaceFilePaths,
    bounceZones,
    scalperUserConfig,
    setScalperUserConfig,
    applyFileEdit,
    addUserAlgo,
    githubWorkspace,
    localWorkspaceHandle,
    pendingLocalEdits,
    pushPendingToGitHub,
  } = useApp();

  // Effective model = session override merged onto global
  const activeSession = chatSessions.find((s) => s.id === activeChatId);
  const model: ModelSettings = useMemo(
    () => ({ ...globalModel, ...activeSession?.modelOverride }),
    [globalModel, activeSession?.modelOverride],
  );

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [applyingPaths, setApplyingPaths] = useState<string[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [commitResults, setCommitResults] = useState<Map<string, CommitResult>>(new Map());
  const [diffState, setDiffState] = useState<DiffState>(null);
  const [diffOriginal, setDiffOriginal] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [deployStatus] = useState<WorkflowRunStatus | null | undefined>(undefined);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atMentionedPaths, setAtMentionedPaths] = useState<string[]>([]);

  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isInitialFeedLayout = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Deploy status ──────────────────────────────────────────────────
  // Deploy status polling removed — Vercel auto-deploys on push, no workflow file needed.
  const fetchDeployStatus = useCallback(async () => { /* no-op */ }, []);
  void fetchDeployStatus;

  // ── Scroll ────────────────────────────────────────────────────────
  const { leadingAssistants, conversation } = useMemo(() => {
    const leading: ChatMessage[] = [];
    let i = 0;
    while (i < messages.length && messages[i].role === "assistant") { leading.push(messages[i]); i++; }
    return { leadingAssistants: leading, conversation: messages.slice(i) };
  }, [messages]);

  const turns = useMemo(() => groupTurns(conversation), [conversation]);
  const latestUserId = turns.at(-1)?.user.id ?? null;

  useLayoutEffect(() => {
    const feed = feedScrollRef.current;
    if (!latestUserId || !feed) return;
    if (isInitialFeedLayout.current) { isInitialFeedLayout.current = false; return; }
    const id = latestUserId;
    let raf = 0; let cancelled = false; let frames = 0;
    const step = () => {
      if (cancelled) return;
      scrollTurnToTop(feed, id);
      frames += 1;
      if (frames < 6) raf = requestAnimationFrame(step);
    };
    scrollTurnToTop(feed, id);
    raf = requestAnimationFrame(step);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [latestUserId]);

  // Reset scroll ref on tab switch
  useEffect(() => { isInitialFeedLayout.current = true; }, [activeChatId]);

  // ── Apply helpers ─────────────────────────────────────────────────
  async function applyOne(
    path: string,
    code: string,
    targetMsgId?: string,
  ): Promise<string | null> {
    try {
      const sha = await applyFileEdit(path, code);
      if (targetMsgId) {
        setCommitResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(targetMsgId);
          if (existing) {
            next.set(targetMsgId, { sha, paths: [...existing.paths, path] });
          } else {
            next.set(targetMsgId, { sha, paths: [path] });
          }
          return next;
        });
      }
      return sha;
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function openDiff(path: string, code: string) {
    const { token, owner, repo, branch } = githubWorkspace;
    setDiffState({ path, code, original: "" });
    setDiffLoading(true);
    try {
      if (token && owner && repo) {
        const { text } = await githubGetFileContent(token, owner, repo, branch || "main", path);
        setDiffOriginal(text);
      } else {
        setDiffOriginal("");
      }
    } catch {
      setDiffOriginal("");
    } finally {
      setDiffLoading(false);
      setDiffState((prev) => prev && { ...prev });
    }
  }

  function handleApplyConfig(patch: ReturnType<typeof parseConfigPatch>) {
    if (!patch) return;
    setScalperUserConfig(patch);
  }

  const [pushingToGitHub, setPushingToGitHub] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  async function handlePushToGitHub() {
    setPushingToGitHub(true);
    setPushError(null);
    try {
      await pushPendingToGitHub();
    } catch (e) {
      setPushError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushingToGitHub(false);
    }
  }

  async function handleApplyAll(edits: { path: string; code: string }[], targetMsgId?: string) {
    setApplyingPaths(edits.map((e) => e.path));
    setApplyError(null);
    let lastSha = "";
    for (const edit of edits) {
      const sha = await applyOne(edit.path, edit.code, targetMsgId);
      if (sha) lastSha = sha;
      setApplyingPaths((prev) => prev.filter((p) => p !== edit.path));
    }
    setApplyingPaths([]);
    if (lastSha) void fetchDeployStatus();
  }

  // ── @ mention handling ────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf("@");
    if (atIdx !== -1 && !beforeCursor.slice(atIdx).includes(" ")) {
      setAtQuery(beforeCursor.slice(atIdx + 1));
    } else {
      setAtQuery(null);
    }
  }

  function selectAtMention(path: string) {
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const beforeCursor = input.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf("@");
    const newInput = input.slice(0, atIdx) + `@${path}` + input.slice(cursor);
    setInput(newInput);
    setAtQuery(null);
    if (!atMentionedPaths.includes(path)) setAtMentionedPaths((prev) => [...prev, path]);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // ── Image attachment ──────────────────────────────────────────────
  function handleImageFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        if (url) setAttachedImages((prev) => [...prev, url]);
      };
      reader.readAsDataURL(f);
    }
  }

  function handleComposerDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setIsDragOver(true); }
  }
  function handleComposerDragLeave() { setIsDragOver(false); }
  function handleComposerDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    handleImageFiles(e.dataTransfer.files);
  }

  // ── Send ──────────────────────────────────────────────────────────
  const apiKeyOptional = presetAllowsOptionalApiKey(model) || isLikelyLocalLlm(model.baseUrl);
  const showMissingKeyBanner = !apiKeyOptional && !model.apiKey.trim();

  function openSetupForLlm() {
    openSetupPanel();
  }

  function stopGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setComposerBusy(false);
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if ((!text && attachedImages.length === 0) || pending) return;

    const prior = messages;
    appendMessage({ role: "user", content: text || "(image)" });
    const capturedImages = attachedImages;
    setInput("");
    setAttachedImages([]);
    setAtMentionedPaths([]);
    setAtQuery(null);
    setApplyError(null);
    setPending(true);
    setComposerBusy(true);

    if (CHAT_SIMULATE) {
      const assistantId = appendMessage({ role: "assistant", content: "" });
      try { await streamGibberishReply(assistantId, updateMessage); }
      finally { setPending(false); setComposerBusy(false); }
      return;
    }

    if (!model.apiKey.trim() && !apiKeyOptional) {
      appendMessage({ role: "assistant", content: "Add your LLM API key in Setup (key icon), or use Ollama locally." });
      setPending(false); setComposerBusy(false); return;
    }

    const trimmedKey = model.apiKey.trim();
    if (trimmedKey && isOpenRouterBaseUrl(model.baseUrl)) {
      const wrongIssuer = wrongProviderKeyForOpenRouterHint(trimmedKey);
      if (wrongIssuer) {
        appendMessage({ role: "assistant", content: wrongIssuer });
        setPending(false); setComposerBusy(false); return;
      }
    }

    // Create the abort controller immediately so Stop works during @mention fetches too
    const abort = new AbortController();
    abortRef.current = abort;

    const assistantId = appendMessage({ role: "assistant", content: "" });

    // Build history
    const history = [
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    // Fetch @mentioned files (respects the abort signal)
    let mentionContext = "";
    if (atMentionedPaths.length > 0) {
      const { token, owner, repo, branch } = githubWorkspace;
      if (token && owner && repo) {
        const snippets: string[] = [];
        for (const p of atMentionedPaths.slice(0, 3)) {
          if (abort.signal.aborted) break;
          try {
            const { text: fileText } = await githubGetFileContent(token, owner, repo, branch || "main", p);
            snippets.push(`### @${p}\n\`\`\`\n${fileText.slice(0, 4000)}\n\`\`\``);
          } catch { /* skip */ }
        }
        if (snippets.length) mentionContext = "\n\n## @mentioned files\n" + snippets.join("\n\n");
      }
    }

    // Bail out cleanly if the user stopped during the mention fetch phase
    if (abort.signal.aborted) {
      updateMessage(assistantId, { content: "(stopped)" });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }

    const liveContext = buildLiveContext({
      chartAnalytics,
      selectedAlgoId,
      userAlgos,
      tradingMode,
      openFilePath,
      openFileContent,
      workspaceFilePaths,
      bounceZones,
      scalperUserConfig,
    });

    const systemContent =
      buildComposerSystemPrompt(githubWorkspace) +
      "\n\n---\n" +
      liveContext +
      mentionContext;

    // ── Guaranteed status so the bubble is never empty on error ──────
    const setStatus = (msg: string) => updateMessage(assistantId, { content: msg });

    try {
      if (isAnthropicMessagesApiBaseUrl(model.baseUrl)) {
        const aUrl = resolveLlmApiUrl(anthropicMessagesUrl(model.baseUrl));
        const aHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "anthropic-version": ANTHROPIC_API_VERSION,
          "x-api-key": trimmedKey,
          "anthropic-dangerous-direct-browser-access": "true",
        };
        let aBody = buildAnthropicMessagesBody({ model: model.model, system: systemContent, history, stream: true });
        if (capturedImages.length > 0) {
          const msgs = aBody.messages as Array<{ role: string; content: unknown }>;
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0) {
            const last = msgs[lastIdx]!;
            const imageBlocks = capturedImages.map((url) => {
              const mimeMatch = url.match(/^data:([^;]+);base64,/);
              const mediaType = (mimeMatch?.[1] ?? "image/png") as string;
              return { type: "image", source: { type: "base64", media_type: mediaType, data: url.replace(/^data:[^;]+;base64,/, "") } };
            });
            const patched = [...msgs];
            patched[lastIdx] = { ...last, content: [...imageBlocks, { type: "text", text: last.content }] };
            aBody = { ...aBody, messages: patched };
          }
        }

        // 20 s to get the first HTTP response byte (shorter than 90 s, shows error faster)
        const connDeadline = new AbortController();
        const connTid = window.setTimeout(
          () => connDeadline.abort(new DOMException("Anthropic first-byte timeout (20 s)", "AbortError")),
          20_000,
        );

        let res: Response;
        try {
          res = await fetch(aUrl, {
            method: "POST",
            headers: aHeaders,
            body: JSON.stringify(aBody),
            signal: mergeAbortSignals(abort.signal, connDeadline.signal),
          });
        } finally {
          window.clearTimeout(connTid);
        }

        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          const errRaw = await res.text().catch(() => `HTTP ${res.status}`);
          // Extract a readable message from Anthropic's JSON error body
          let errMsg = errRaw.slice(0, 500);
          try {
            const j = JSON.parse(errRaw) as { error?: { message?: string; type?: string } };
            if (j.error?.message) errMsg = j.error.message;
          } catch { /* keep raw text */ }
          const hint =
            res.status === 401
              ? "\n\n**Fix:** Check your Anthropic API key in Setup — it may be wrong or expired."
              : res.status === 429
                ? "\n\n**Rate limit hit.** Your Anthropic account is out of tokens for now.\n- Wait a minute and try again\n- Check usage at [console.anthropic.com](https://console.anthropic.com/)\n- Upgrade your plan or add credits if needed"
                : res.status === 529
                  ? "\n\nAnthropic is overloaded — try again in a moment."
                  : res.status === 402
                    ? "\n\n**Fix:** Add credits at [console.anthropic.com/billing](https://console.anthropic.com/billing)."
                    : "\n\nCheck model name, billing, and [Anthropic status](https://status.anthropic.com).";
          console.error("[chat] Anthropic error", res.status, errRaw);
          setStatus(`**Anthropic error ${res.status}:** ${errMsg}${hint}`);
          return;
        }

        if (ct.includes("text/event-stream")) {
          let acc = "";
          // Use a zero-width space as placeholder so the "Connecting…" spinner disappears
          // the instant the server responds, without showing any visible character.
          setStatus("\u200B");
          await consumeAnthropicMessageStream(
            res.body,
            (chunk) => {
              acc += chunk;
              updateMessage(assistantId, { content: acc });
            },
            { signal: abort.signal, idleMs: 30_000 },
          );
          if (!acc.trim()) setStatus("(empty response — check model id and Anthropic status)");
          return;
        }

        // Non-streaming JSON response
        const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        const txt = data.content?.find((c) => c.type === "text")?.text?.trim() || "";
        setStatus(txt || "(empty response)");
        return;
      }

      const url = resolveChatCompletionUrl(model.baseUrl);
      const providerLabel = model.providerLabel || "LLM";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (model.apiKey.trim()) {
        const bearer = "Bearer " + model.apiKey.trim();
        headers["Authorization"] = bearer;
        headers["X-UNT-LLM-Authorization"] = bearer;
      }
      if (isOpenRouterBaseUrl(model.baseUrl)) {
        headers["Referer"] = import.meta.env.VITE_OPENROUTER_REFERRER || window.location.origin || "http://localhost:5173";
        headers["X-Title"] = import.meta.env.VITE_OPENROUTER_APP_TITLE || "Unknown Name Trader";
      }

      // 20 s connection timeout — same as Anthropic path
      const oadl = new AbortController();
      const oadlTid = window.setTimeout(
        () => oadl.abort(new DOMException(`${providerLabel} first-byte timeout (20 s)`, "AbortError")),
        20_000,
      );
      let res: Response;
      try {
        res = await fetch(url, {
        method: "POST",
        headers,
          signal: mergeAbortSignals(abort.signal, oadl.signal),
          body: JSON.stringify({
            model: model.model,
            stream: true,
            messages: [
              { role: "system", content: systemContent },
              ...history.map((m, i) => {
                if (i === history.length - 1 && m.role === "user" && capturedImages.length > 0) {
                  return {
                    role: m.role,
                    content: [
                      ...capturedImages.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
                      { type: "text", text: m.content },
                    ],
                  };
                }
                return m;
              }),
            ],
          }),
      });
      } finally {
        window.clearTimeout(oadlTid);
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const errRaw = await res.text().catch(() => `HTTP ${res.status}`);
        let errMsg = errRaw.slice(0, 500);
        try {
          const j = JSON.parse(errRaw) as { error?: { message?: string } };
          if (j.error?.message) errMsg = j.error.message;
        } catch { /* keep raw */ }
        const hint =
          res.status === 401
            ? `\n\n**Fix:** Check your ${providerLabel} API key in Setup.`
            : res.status === 429
              ? `\n\n**Rate limit hit.** Wait a moment and try again, or check your ${providerLabel} plan/credits.`
              : res.status === 402
                ? `\n\n**Fix:** Add credits to your ${providerLabel} account.`
                : "";
        setStatus(`**${providerLabel} error ${res.status}:** ${errMsg}${hint}`);
        return;
      }
      if (ct.includes("text/event-stream")) {
        let acc = "";
        setStatus("\u200B");
        await consumeChatCompletionStream(res.body, (chunk) => { acc += chunk; updateMessage(assistantId, { content: acc }); });
        if (!acc.trim()) setStatus("(empty response — check model name and API key)");
        return;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      setStatus(data.choices?.[0]?.message?.content?.trim() || "(empty response)");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[chat] send error", e);

      if ((e as Error).name === "AbortError") {
        if (abort.signal.aborted) {
          setStatus("(stopped)");
        } else {
          // Fired by our connDeadline or oadl timer — not the user pressing Stop
          const isAnthropic = isAnthropicMessagesApiBaseUrl(model.baseUrl);
          let providerHost = isAnthropic ? "api.anthropic.com" : model.baseUrl;
          try { providerHost = new URL(model.baseUrl).hostname; } catch { /* keep raw url */ }
          setStatus(
            `No response within 20 s.\n\n` +
            `**Common causes:**\n` +
            `- API key wrong or expired (check Setup)\n` +
            `- Network / firewall blocking \`${providerHost}\`\n` +
            (browserLlmProxyEnabled()
              ? "- Dev proxy issue — check terminal for errors"
              : `- CORS: deployed builds call \`${providerHost}\` directly from the browser`),
          );
        }
        return;
      }

      if (/stalled/i.test(msg)) {
        setStatus(
          `${msg}\n\n` +
          "The stream connected but stopped sending data. " +
          (browserLlmProxyEnabled()
            ? "Check the terminal proxy logs."
            : "On deployed sites, calls go direct to Anthropic — check network and CORS."),
        );
        return;
      }

      const isCors = /failed to fetch|networkerror|cors/i.test(msg);
      setStatus(
        `Request failed: ${msg}` +
        (isCors
          ? "\n\n**Likely CORS / network block.** On deployed sites the browser calls `api.anthropic.com` directly — confirm your host allows outbound requests. Run via `npm run dev` locally to use the built-in proxy."
          : !browserLlmProxyEnabled()
            ? " (Hosted builds call providers directly — check API key and network.)"
            : ""),
      );
    } finally {
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
    }
  }

  async function copyMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div
      id="chat-panel"
      className="flex h-full min-h-0 min-w-[300px] flex-col"
      style={{ background: "var(--color-bg-editor)", borderLeft: "1px solid var(--color-border)" }}
    >
      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-[var(--color-border-subtle)] px-1"
        style={{ background: "var(--color-bg-sideBar)", scrollbarWidth: "none" }}
      >
        {chatSessions.map((session) => {
          const active = session.id === activeChatId;
          return (
            <div
              key={session.id}
              className={
                "group/tab flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[11.5px] transition-colors " +
                (active
                  ? "border-[var(--color-fg-muted)] text-[var(--color-fg)]"
                  : "border-transparent text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]")
              }
              onClick={() => { setActiveChatId(session.id); setApplyError(null); }}
            >
              {renamingTabId === session.id ? (
                <input
                  autoFocus
                  defaultValue={session.name}
                  className="w-24 bg-transparent text-[11.5px] outline-none"
                  onBlur={(e) => { renameChatSession(session.id, e.target.value || session.name); setRenamingTabId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { renameChatSession(session.id, e.currentTarget.value || session.name); setRenamingTabId(null); }
                    if (e.key === "Escape") setRenamingTabId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="max-w-[100px] truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); setRenamingTabId(session.id); }}
                  title={session.name}
                >
                  {session.name}
                </span>
              )}
              <button
                type="button"
                title="Close tab"
                onClick={(e) => { e.stopPropagation(); closeChatSession(session.id); }}
                className="ml-0.5 rounded p-0.5 text-[var(--color-fg-dim)] opacity-0 hover:bg-[var(--color-fill)] hover:text-[var(--color-fg)] group-hover/tab:opacity-100"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          title="New chat"
          onClick={newChatSession}
          className="shrink-0 rounded-lg p-2 text-[var(--color-fg-dim)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)]"
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header
        className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5"
        style={{ background: "var(--color-bg-editor)", borderBottom: "1px solid var(--color-border-subtle)" }}
      >
        <div className="min-w-0 flex-1">
          <h2 className="unt-section-title">Algo assistant</h2>
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate font-mono text-[10px] leading-snug text-[var(--color-fg-dim)]" title={`${model.providerLabel} · ${model.model}`}>
              {model.providerLabel} · {model.model}
            </p>
            <DeployBadge run={deployStatus} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeSession?.modelOverride ? (
            <button
              type="button"
              title="Reset to global model"
              onClick={() => clearSessionModel(activeChatId)}
              className="rounded-lg px-2 py-1.5 text-[10px] text-amber-400/70 hover:bg-[var(--color-fill)] hover:text-amber-400"
            >
              custom model ×
            </button>
          ) : null}
          <button type="button" title="Clear conversation" onClick={clearChat} className="rounded-lg p-2 text-[var(--color-fg-dim)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)]">
            <Trash2 className="size-[15px]" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/* ── Feed ────────────────────────────────────────────────────── */}
      <div
        ref={feedScrollRef}
        className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-4 py-4"
        style={{ overflowAnchor: "none" }}
      >
        <StandaloneAssistantIntro messages={leadingAssistants} copiedId={copiedId} onCopy={copyMessage} />
        {leadingAssistants.length === 0 && turns.length === 0 ? (
          <ChatEmptyState
            showMissingKeyBanner={showMissingKeyBanner}
            localWorkspaceConnected={localWorkspaceHandle !== null}
            githubWired={Boolean(githubWorkspace.owner && githubWorkspace.repo)}
            onOpenSetup={openSetupForLlm}
            onSend={(text) => void send(text)}
          />
        ) : null}
        {turns.map((turn, idx) => (
          <ChatTurnSection
            key={turn.user.id}
            turn={turn}
            isLatestTurn={idx === turns.length - 1}
            pending={pending}
            copiedId={copiedId}
            commitResults={commitResults}
            githubWorkspace={githubWorkspace}
            localWorkspaceConnected={localWorkspaceHandle !== null}
            onCopy={copyMessage}
            onDiff={(path, code) => void openDiff(path, code)}
            onApplyAll={(edits) => void handleApplyAll(edits, turns[idx]?.assistant?.id)}
            onAddAlgo={addUserAlgo}
            onApplyConfig={handleApplyConfig}
            onSend={(text) => void send(text)}
            onDismissCommit={(msgId) => setCommitResults((prev) => { const next = new Map(prev); next.delete(msgId); return next; })}
            onLoadMint={navigateChartToMint}
          />
        ))}
      </div>

      {/* ── Composer ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        {/* ── Local workspace status + Push strip ─────────────── */}
        {localWorkspaceHandle ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,#22d3ee_20%,transparent)] bg-[color-mix(in_srgb,#22d3ee_5%,transparent)] px-3 py-1.5 text-[11px]">
            <span className="size-1.5 shrink-0 rounded-full bg-cyan-400/80" />
            <span className="text-cyan-300/70">Local workspace connected — edits write to disk instantly</span>
            {pendingLocalEdits.size > 0 ? (
              <button
                type="button"
                disabled={pushingToGitHub}
                onClick={() => void handlePushToGitHub()}
                title="Commit all locally-written files to your GitHub repo"
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,#22d3ee_30%,transparent)] px-2 py-0.5 text-[10.5px] font-medium text-cyan-300/80 transition-colors hover:border-[color-mix(in_srgb,#22d3ee_50%,transparent)] hover:text-cyan-200 disabled:opacity-50"
              >
                {pushingToGitHub ? (
                  <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                ) : (
                  <Rocket className="size-3" strokeWidth={1.5} />
                )}
                Push {pendingLocalEdits.size} file{pendingLocalEdits.size !== 1 ? "s" : ""} to GitHub
              </button>
            ) : null}
          </div>
        ) : null}
        {pushError ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11.5px] text-red-400/80">
            {pushError}
            <button type="button" onClick={() => setPushError(null)} className="ml-auto shrink-0 underline opacity-70 hover:opacity-100">dismiss</button>
          </div>
        ) : null}

        {/* Status banners */}
        {applyingPaths.length > 0 ? (
          <div className="mb-2 flex items-center gap-2 px-1 text-[11.5px] text-[var(--color-fg-dim)]">
            <Loader2 className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
            {localWorkspaceHandle ? "Writing" : "Applying"} {applyingPaths.join(", ")}…
          </div>
        ) : applyError ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11.5px] text-red-400/80">
            {applyError}
            <button type="button" onClick={() => setApplyError(null)} className="ml-auto shrink-0 underline opacity-70 hover:opacity-100">dismiss</button>
          </div>
        ) : null}

        {showMissingKeyBanner ? (
          <div className="mb-2 px-1 text-[12px] text-[var(--color-fg-dim)]">
            <button type="button" className="font-medium text-[var(--color-fg-muted)] underline underline-offset-2 hover:text-[var(--color-fg)]" onClick={openSetupForLlm}>
              Add an API key in Setup
            </button>
            {" "}to start chatting.
          </div>
        ) : null}

        {/* Hidden file input for image attachment */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { handleImageFiles(e.target.files); e.target.value = ""; }}
        />

        {/* Input box */}
        <div
          className={`unt-composer-input-wrap relative transition-colors${isDragOver ? " ring-1 ring-[var(--color-fg-muted)] bg-[rgba(255,255,255,0.03)]" : ""}`}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          {atQuery !== null ? (
            <AtMentionDropdown
              query={atQuery}
              paths={workspaceFilePaths}
              onSelect={selectAtMention}
            />
          ) : null}

          {/* Image thumbnails */}
          {attachedImages.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
              {attachedImages.map((url, i) => (
                <div key={i} className="relative shrink-0 group">
                  <img
                    src={url}
                    alt="attachment"
                    className="h-16 w-16 rounded-md object-cover border border-[var(--color-border-subtle)]"
                  />
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--color-bg-editor)] border border-[var(--color-border-subtle)] text-[var(--color-fg-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-fg)]"
                  >
                    <X className="size-2.5" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            rows={3}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              if (e.key === "Escape" && atQuery !== null) { setAtQuery(null); }
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData.items);
              const imageItems = items.filter((it) => it.type.startsWith("image/"));
              if (imageItems.length > 0) {
                e.preventDefault();
                imageItems.forEach((it) => {
                  const f = it.getAsFile();
                  if (f) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const url = ev.target?.result as string;
                      if (url) setAttachedImages((prev) => [...prev, url]);
                    };
                    reader.readAsDataURL(f);
                  }
                });
              }
            }}
            placeholder={isDragOver ? "Drop image here…" : "Message the assistant… (@ to mention a file)"}
            disabled={pending}
            className="unt-composer-textarea w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] leading-relaxed text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)] disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <div className="flex items-center gap-2 pl-0.5">
              <button
                type="button"
                title="Attach image"
                disabled={pending}
                onClick={() => fileInputRef.current?.click()}
                className="flex size-6 items-center justify-center rounded text-[var(--color-fg-dim)] transition-colors hover:text-[var(--color-fg-muted)] disabled:opacity-30"
              >
                <ImagePlus className="size-3.5" strokeWidth={1.75} />
              </button>
              <span className="text-[10.5px] text-[var(--color-fg-dim)]">
                ↵ send · ⇧↵ newline · @ file
              </span>
            </div>
            {pending ? (
              <button
                type="button"
                onClick={stopGeneration}
                title="Stop generating"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-subtle)] text-[var(--color-fg-muted)] transition-all hover:border-[rgba(255,255,255,0.2)] hover:text-[var(--color-fg)]"
              >
                <CircleStop className="size-3.5" strokeWidth={2} />
              </button>
            ) : (
            <button
              type="button"
                disabled={!input.trim() && attachedImages.length === 0}
              onClick={() => void send()}
                title="Send"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-fg-dim)] text-[var(--color-bg-editor)] transition-all hover:bg-[var(--color-fg-muted)] disabled:opacity-25"
              >
                <ArrowUp className="size-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Diff modal ───────────────────────────────────────────────── */}
      {diffState && !diffLoading && diffOriginal !== null ? (
        <DiffModal
          path={diffState.path}
          original={diffOriginal}
          modified={diffState.code}
          onCancel={() => { setDiffState(null); setDiffOriginal(null); }}
          onApply={() => {
            const { path, code } = diffState;
            setDiffState(null);
            setDiffOriginal(null);
            void (async () => {
              setApplyingPaths([path]);
              setApplyError(null);
              const targetMsgId = turns.at(-1)?.assistant?.id;
              await applyOne(path, code, targetMsgId);
              setApplyingPaths([]);
              void fetchDeployStatus();
            })();
          }}
        />
      ) : diffLoading ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] px-5 py-4" style={{ background: "var(--color-bg-sideBar)" }}>
            <Loader2 className="size-5 animate-spin text-[var(--color-fg-muted)]" strokeWidth={2} />
            <span className="text-[13px] text-[var(--color-fg-muted)]">Loading diff…</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
