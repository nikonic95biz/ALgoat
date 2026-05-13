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
  ImagePlus,
  Loader2,
  Pencil,
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
import {
  type LlmBackendId,
  LLM_BACKENDS,
  getLlmBackend,
  inferBackendIdFromBaseUrl,
} from "@/lib/llmBackends";
import { LlmConnectCard } from "@/components/LlmConnectCard";
import { wrongProviderKeyForOpenRouterHint } from "@/lib/openRouterKeyHints";
import { consumeAnthropicMessageStream } from "@/lib/streamAnthropic";
import { consumeChatCompletionStream } from "@/lib/streamChat";
import { executeTool } from "@/lib/agentTools";
import { mergeAbortSignals } from "@/lib/mergeAbortSignals";
import {
  githubGetFileContent,
  type WorkflowRunStatus,
} from "@/lib/githubApi";
import { readLocalFile } from "@/lib/localWorkspace";
import type { ChatMessage, ModelSettings } from "@/types";
import { ChatEmptyState } from "@/components/_ChatEmptyState";


// ─── Helpers ──────────────────────────────────────────────────────────────────

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

type AppliedFileBackup = {
  path: string;
  previousContent: string | null;
  existedBefore: boolean;
};

type ChatMode = "chat" | "build";
type BuildCapability = "full-ide" | "write-only" | "blocked";
type BuildFlowState =
  | "chat"
  | "build_confirm_pending"
  | "build_running"
  | "build_verifying"
  | "build_done"
  | "build_failed";

type BuildArtifacts = {
  edits: ReturnType<typeof parseChatEdits>;
  algos: ReturnType<typeof parseAlgoBlocks>;
  configPatch: ReturnType<typeof parseConfigPatch>;
  issues: string[];
  validForApply: boolean;
};

// ── Token budget constants ────────────────────────────────────────────────────
// Anthropic's TPM limit is 30k input tokens/minute (for the free/starter tier).
// Every tool round is a NEW API request — and the request includes ALL prior
// turns, the full system prompt, and ALL tool definitions, every time.
// We use a rolling 60-second token-bucket throttle below to stay under the cap.
const MAX_ANTHROPIC_SYSTEM_CHARS = 10_000;   // ~2,500 tokens
const MAX_ANTHROPIC_HISTORY_CHARS = 4_000;   // ~1,000 tokens
const MAX_LIVE_CONTEXT_CHARS = 3_000;        // ~750 tokens
const MAX_REPO_POLICY_CHARS = 600;
const MAX_MENTION_CONTEXT_CHARS = 2_500;
const ANTHROPIC_CHAT_MAX_TOKENS = 2_048;
const ANTHROPIC_BUILD_MAX_TOKENS = 8_192;

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

function clipMiddle(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 32) / 2);
  return (
    text.slice(0, Math.max(0, half)) +
    `\n\n...[${label} trimmed]...\n\n` +
    text.slice(Math.max(0, text.length - half))
  );
}

function trimHistoryByChars(history: Array<{ role: string; content: string }>, maxChars: number) {
  let used = 0;
  const kept: Array<{ role: string; content: string }> = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    const cost = h.content.length + 16;
    if (used + cost > maxChars && kept.length > 0) break;
    kept.push(h);
    used += cost;
  }
  return kept.reverse();
}

function stripToolTraceTags(text: string): string {
  if (!text) return text;
  const cleaned = text
    // Remove full tool blocks when well-formed
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, "")
    // Remove truncated/unclosed tool blocks (common on max_tokens stops)
    .replace(/<tool_call>[\s\S]*$/gi, "")
    .replace(/<tool_response>[\s\S]*$/gi, "")
    // Remove stray opening/closing tags that may stream in partial chunks
    .replace(/<\/?tool_(call|response)>/gi, "")
    // Remove common tool narration preambles that are not user-facing output
    .replace(/(^|\n)Reading:[^\n]*(\n|$)/gi, "\n")
    .replace(/(^|\n)Let me retrieve those now\.[^\n]*(\n|$)/gi, "\n")
    .replace(/(^|\n)Let me pull the files[^\n]*(\n|$)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

function isExplicitBuildCommand(text: string): boolean {
  return (
    /\b(build it|implement this|start building|go ahead and build|ship it|patch it now)\b/i.test(text) ||
    /^(build|implement|patch|edit|modify|wire|refactor)\b/i.test(text.trim())
  );
}

function isCodeInvestigationIntent(text: string): boolean {
  return (
    /\b(look into|investigate|diagnose|debug|audit|review|analyze|inspect|check|trace|understand)\b/i.test(text) &&
    /\b(code|repo|codebase|file|files|component|context|runtime|flow|bug|issue|error)\b/i.test(text)
  ) || /\b(where is|why is|what is causing|how does)\b/i.test(text);
}

function isPotentialBuildIntent(text: string): boolean {
  return (
    /\b(build|implement|edit|patch|fix|wire|refactor|write|modify|code|ship|integrate)\b/i.test(text) ||
    /\b(make it real|start building|build it|continue build|add this preset|build this into the app)\b/i.test(text) ||
    /\b(code|file|component|hook|function|typescript|tsx|build error|typecheck)\b/i.test(text) ||
    (/\b(add|update|change|create)\b/i.test(text) &&
      /\b(code|file|component|ui|button|tab|panel|backend|frontend|app|engine|preset)\b/i.test(text))
  );
}

function isBuildConfirmationYes(text: string): boolean {
  return /^(yes|y|yeah|yep|ok|okay|sure|go ahead|do it|build it|start|ready)\b/i.test(text.trim());
}

function isBuildConfirmationNo(text: string): boolean {
  return /^(no|n|not now|later|cancel|stop)\b/i.test(text.trim());
}

function needsTradingContext(text: string): boolean {
  return /\b(token|mint|chart|price|market cap|mc|candle|order book|tape|buy|sell|trade|trading|session|pnl|wallet|pumpportal|nursery|zombie|watchlist|position|entry|exit|stop|take profit|scalper)\b/i.test(text);
}

function needsWorkspaceContext(text: string): boolean {
  return /@src\//i.test(text) || /\b(open file|file tree|workspace|repo|repository|path|where is|which file)\b/i.test(text);
}

function buildCapability({
  localIdeAgentReady,
  localWorkspaceHandle,
  workspaceReady,
}: {
  localIdeAgentReady: boolean;
  localWorkspaceHandle: FileSystemDirectoryHandle | null;
  workspaceReady: boolean;
}): BuildCapability {
  if (localIdeAgentReady) return "full-ide";
  if (localWorkspaceHandle && workspaceReady) return "write-only";
  return "blocked";
}

function buildBlockedMessage(capability: BuildCapability, hasWorkspace: boolean): string {
  if (capability !== "blocked") return "";
  return hasWorkspace
    ? "Build is blocked because the local workspace permission is not ready. Reconnect or re-authorize the project folder, then try again."
    : "Build is blocked because no local workspace folder is connected. Connect the project folder first so ALgoat can read and write files.";
}

function canTransitionBuildFlow(from: BuildFlowState, to: BuildFlowState): boolean {
  switch (from) {
    case "chat":
      return to === "chat" || to === "build_confirm_pending" || to === "build_running";
    case "build_confirm_pending":
      return to === "chat" || to === "build_running" || to === "build_failed";
    case "build_running":
      return to === "build_running" || to === "build_verifying" || to === "build_done" || to === "build_failed" || to === "chat";
    case "build_verifying":
      return to === "build_done" || to === "build_failed" || to === "chat";
    case "build_done":
      return to === "chat" || to === "build_running" || to === "build_confirm_pending";
    case "build_failed":
      return to === "chat" || to === "build_running" || to === "build_confirm_pending";
    default:
      return false;
  }
}

function parseBuildArtifacts(content: string): BuildArtifacts {
  const edits = parseChatEdits(content);
  const algos = parseAlgoBlocks(content);
  const configPatch = parseConfigPatch(content);
  const issues: string[] = [];

  if (/\[Stopped:\s*max_tokens\]/i.test(content)) {
    issues.push("Response was truncated (max_tokens).");
  }
  if (/<\/?tool_(call|response)>/i.test(content)) {
    issues.push("Tool trace tags detected in output.");
  }

  const badPath = edits.find((e) =>
    e.path.startsWith("/") ||
    e.path.includes("..") ||
    e.path.includes("\\") ||
    e.path.trim().length === 0,
  );
  if (badPath) issues.push(`Unsafe edit path blocked: ${badPath.path}`);
  if (edits.length > 12) issues.push(`Too many file edits in one response (${edits.length}).`);

  const validForApply =
    issues.length === 0 &&
    (edits.length > 0 || algos.length > 0 || Boolean(configPatch));
  return { edits, algos, configPatch, issues, validForApply };
}

/** Fenced blocks collapse tall snippets behind a header + chevron so replies don’t dominate the feed. */
const chatFenceOpenMemory = new Set<string>();

function CollapsibleFence({ children }: { children?: ReactNode }) {
  let lang = "Code";
  if (isValidElement(children) && children.type === "code") {
    const p = children.props as { className?: string };
    const m = /language-([\w-]+)/.exec(p.className ?? "");
    if (m?.[1]) lang = m[1];
  }

  const raw = flattenMarkdownText(children).replace(/\n$/, "");
  const lineCount = raw ? raw.split("\n").length : 0;
  const sizable = lineCount > 5 || raw.length > 360;
  // Persist expanded state across stream rerenders to prevent flicker.
  const fenceMemoryKey = `${lang}|${raw.slice(0, 220)}`;
  const [open, setOpen] = useState(() => chatFenceOpenMemory.has(fenceMemoryKey));
  useEffect(() => {
    setOpen(chatFenceOpenMemory.has(fenceMemoryKey));
  }, [fenceMemoryKey]);
  useEffect(() => {
    if (!sizable) return;
    if (open) chatFenceOpenMemory.add(fenceMemoryKey);
    else chatFenceOpenMemory.delete(fenceMemoryKey);
  }, [open, sizable, fenceMemoryKey]);
  const expanded = open || !sizable;

  return (
    <div className="unt-chat-fence my-3 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[#0e0e0e]">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (sizable) setOpen((v) => !v);
        }}
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


// ─── Sub-components ───────────────────────────────────────────────────────────

function Prose({ content }: { content: string }) {
  return (
    <div className="chat-prose chat-prose-assistant pr-8">
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
    <div className="mt-3 flex flex-wrap gap-2">
      {mints.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onLoadMint(m)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] font-medium text-cyan-100/95 transition-colors hover:border-cyan-300/50 hover:bg-cyan-500/15"
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
  buildFlowState,
  autoApplied,
  onApplyAll,
  onAddAlgo,
  onApplyConfig,
}: {
  content: string;
  pending: boolean;
  buildFlowState?: BuildFlowState;
  autoApplied?: boolean;
  onApplyAll: (edits: { path: string; code: string }[]) => void;
  onAddAlgo: (name: string, description: string) => void;
  onApplyConfig: (patch: ReturnType<typeof parseConfigPatch>) => void;
}) {
  const artifacts = useMemo(() => parseBuildArtifacts(content), [content]);
  const { edits, algos, configPatch, issues, validForApply } = artifacts;
  const newEdits = useMemo(() => edits.filter((e) => e.isNew), [edits]);
  const updatedEdits = useMemo(() => edits.filter((e) => !e.isNew), [edits]);
  const createdFolders = useMemo(
    () =>
      Array.from(
        new Set(
          newEdits
            .map((e) => {
              const i = e.path.lastIndexOf("/");
              return i > 0 ? e.path.slice(0, i) : "";
            })
            .filter(Boolean),
        ),
      ),
    [newEdits],
  );
  const responseTruncated = issues.some((x) => /max_tokens/i.test(x));
  const blockedByState = buildFlowState === "build_running" || buildFlowState === "build_verifying";
  const applyBlocked = blockedByState || !validForApply;

  if ((edits.length === 0 && algos.length === 0 && !configPatch) || pending) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {responseTruncated && edits.length > 0 ? (
        <p className="w-full rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-200/90">
          Partial response detected (<code>max_tokens</code>). File edits may be incomplete — continue build before applying.
        </p>
      ) : null}
      {issues.length > 0 ? (
        <p className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200/90">
          Build artifacts blocked: {issues[0]}
        </p>
      ) : null}
      {blockedByState ? (
        <p className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2 text-[11px] text-[var(--color-fg-dim)]">
          Build is still running verification. Apply actions unlock when build is done.
        </p>
      ) : null}
      {/* Config patch → live knob update */}
      {configPatch ? (
        <button
          type="button"
          onClick={() => onApplyConfig(configPatch)}
          disabled={applyBlocked}
          title="Update live knob values instantly — no deploy needed"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#22d3ee_30%,transparent)] bg-[color-mix(in_srgb,#22d3ee_8%,transparent)] px-3 py-1.5 font-mono text-[11px] font-medium text-cyan-300/80 transition-colors hover:border-[color-mix(in_srgb,#22d3ee_50%,transparent)] hover:text-cyan-200"
        >
          <Check className="size-3 shrink-0" strokeWidth={2} />
          Apply to knobs
        </button>
      ) : null}
      {edits.length > 0 ? (
        <div className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-3 py-2">
          <p className="mb-2 text-[11px] text-[var(--color-fg-muted)]">
            {autoApplied
              ? `Applied ${edits.length} file change${edits.length > 1 ? "s" : ""} automatically.`
              : `Core build patch has ${edits.length} file change${edits.length > 1 ? "s" : ""}.`}
          </p>
          <p className="mb-2 text-[11px] text-[var(--color-fg-dim)]">
            Includes: {newEdits.length} create{newEdits.length === 1 ? "" : "s"}{createdFolders.length > 0 ? ` in ${createdFolders.length} folder${createdFolders.length === 1 ? "" : "s"}` : ""}, {updatedEdits.length} update{updatedEdits.length === 1 ? "" : "s"}.
          </p>
          <details className="mb-2">
            <summary className="cursor-pointer text-[11px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]">
              Show change list
            </summary>
            <div className="mt-1 max-h-24 overflow-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-sideBar)] p-2 text-[10.5px] text-[var(--color-fg-dim)]">
              {edits.map((e, i) => (
                <div key={`${e.path}-${i}`}>
                  {e.isNew ? "create" : "update"} {e.path}
                </div>
              ))}
            </div>
          </details>
          {!autoApplied ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onApplyAll(edits.map((e) => ({ path: e.path, code: e.code })))}
                disabled={applyBlocked}
                title={responseTruncated ? "Response was truncated — continue build before applying." : undefined}
                className={
                  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sideBar)] px-3 py-1.5 font-mono text-[11px] font-medium text-[var(--color-fg-muted)] transition-colors hover:border-[rgba(255,255,255,0.15)] hover:text-[var(--color-fg)] " +
                  (applyBlocked ? "cursor-not-allowed opacity-45 hover:border-[var(--color-border)] hover:text-[var(--color-fg-muted)]" : "")
                }
              >
                <Check className="size-3 shrink-0" strokeWidth={2} />
                Apply now
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {algos.map((algo, i) => (
        <button
          key={`algo-${i}`}
          type="button"
          title={`Add "${algo.name}" to Algo Lab`}
          onClick={() => onAddAlgo(algo.name, algo.description)}
          disabled={applyBlocked}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-1.5 font-mono text-[11px] text-emerald-400/80 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        >
          + Add to Algo Lab: {algo.name}
        </button>
      ))}
    </div>
  );
}

function FollowupPills({ followups, onSend }: { followups: string[]; onSend: (text: string) => void }) {
  if (followups.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {followups.map((f, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            onSend(f);
            // Keep keyboard flow smooth after quick actions
            requestAnimationFrame(() => {
              const el = document.querySelector("#chat-panel textarea") as HTMLTextAreaElement | null;
              el?.focus();
            });
          }}
          className="rounded-full border border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-fill)_68%,transparent)] px-3 py-1 text-[11px] text-[var(--color-fg-dim)] hover:border-[rgba(255,255,255,0.12)] hover:text-[var(--color-fg-muted)]"
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
  buildFlowState,
  autoApplied,
  copiedId,
  commitResults,
  githubWorkspace,
  onCopy,
  onApplyAll,
  onAddAlgo,
  onApplyConfig,
  onSend,
  onEdit,
  onDismissCommit,
  onLoadMint,
}: {
  turn: ChatTurn;
  isLatestTurn: boolean;
  pending: boolean;
  buildFlowState?: BuildFlowState;
  autoApplied?: boolean;
  copiedId: string | null;
  commitResults: Map<string, CommitResult>;
  githubWorkspace: { token: string; owner: string; repo: string; branch: string };
  onCopy: (id: string, content: string) => void;
  onApplyAll: (edits: { path: string; code: string }[]) => void;
  onAddAlgo: (name: string, description: string) => void;
  onApplyConfig: (patch: ReturnType<typeof parseConfigPatch>) => void;
  onSend: (text: string) => void;
  onEdit: (userMsgId: string, newText: string) => void;
  onDismissCommit: (msgId: string) => void;
  onLoadMint: (mint: string) => void;
}) {
  const asst = turn.assistant;
  const commitResult = asst ? commitResults.get(asst.id) : undefined;

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [revertPending, setRevertPending] = useState(false);

  const { followups, cleanContent } = useMemo(
    () => (asst ? parseSuggestedFollowups(asst.content) : { followups: [], cleanContent: "" }),
    [asst],
  );

  function startEdit() {
    setEditText(turn.user.content);
    setEditing(true);
    setRevertPending(false);
  }

  function cancelEdit() {
    setEditing(false);
    setRevertPending(false);
  }

  function commitEdit() {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === turn.user.content) { cancelEdit(); return; }
    setRevertPending(true);
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") cancelEdit();
  }

  function confirmRevert() {
    onEdit(turn.user.id, editText.trim());
    setEditing(false);
    setRevertPending(false);
  }

  function declineRevert() {
    // Keep editing=true so the user returns to the textarea rather than losing their edit.
    setRevertPending(false);
  }

  return (
    <section data-chat-turn-id={turn.user.id} className="shrink-0" style={{ scrollMarginTop: 12 }}>
      {/* User bubble */}
      <div className="group/user mb-3 flex justify-end">
        <div className="relative max-w-[88%]">
          {/* Edit icon — shown on hover when not already editing */}
          {!editing && !pending && (
            <button
              type="button"
              title="Edit message"
              onClick={startEdit}
              className="absolute -left-7 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] group-hover/user:opacity-100"
            >
              <Pencil className="size-3.5" strokeWidth={2} />
            </button>
          )}

          {editing ? (
            <div className="w-full min-w-[240px]">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={Math.min(8, editText.split("\n").length + 1)}
                className="w-full resize-none rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--color-fg)] outline-none"
                style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(96,165,250,0.45)" }}
              />
              <div className="mt-1 flex gap-2 justify-end text-[11px]">
                <button type="button" onClick={cancelEdit} className="px-2 py-0.5 rounded text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]">Cancel</button>
                <button type="button" onClick={commitEdit} className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30">Save · Enter</button>
              </div>
            </div>
          ) : (
            <div className="unt-chat-user-bubble rounded-2xl rounded-tr-sm px-3.5 py-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg)]">
                {turn.user.content}
              </p>
            </div>
          )}

          {/* Revert confirmation popup */}
          {revertPending && (
            <div
              className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl p-3 shadow-xl"
              style={{ background: "var(--color-bg-sideBar)", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              <p className="mb-2.5 text-[12px] leading-snug text-[var(--color-fg-muted)]">
                Resending will remove all messages after this one.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={declineRevert}
                  className="flex-1 rounded-lg py-1.5 text-[12px] font-medium text-[var(--color-fg-dim)] hover:bg-[var(--color-fill)]"
                >
                  Don't Revert
                </button>
                <button
                  type="button"
                  onClick={confirmRevert}
                  className="flex-1 rounded-lg bg-blue-500/20 py-1.5 text-[12px] font-medium text-blue-300 hover:bg-blue-500/30"
                >
                  Revert &amp; Resend
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assistant reply */}
        {asst ? (
          <div className="group/resp relative rounded-xl border border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-fill)_72%,transparent)] px-3.5 py-3">
            {asst.content.length > 0 ? (
              <button
                type="button"
                title="Copy"
                onClick={() => void onCopy(asst.id, asst.content)}
              className="absolute right-2 top-2 z-[20] rounded-md p-1 text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] group-hover/resp:opacity-100"
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
                buildFlowState={buildFlowState}
                autoApplied={autoApplied}
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
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-fill)_68%,transparent)] px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-dim)]">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          <span>Connecting…</span>
          </div>
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
          <div className="group/resp relative rounded-xl border border-[var(--color-border-subtle)] bg-[color-mix(in_srgb,var(--color-fill)_72%,transparent)] px-3.5 py-3">
            <button
              type="button"
              title="Copy"
              onClick={() => void onCopy(asst.id, asst.content)}
              className="absolute right-2 top-2 z-[20] rounded-md p-1 text-[var(--color-fg-dim)] opacity-0 transition-opacity hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] group-hover/resp:opacity-100"
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

// DeployBadge removed — deploy status no longer shown in chat header

// ─── Model footer bar ────────────────────────────────────────────────────────
function ModelFooterBar({
  model,
  onSetModel,
  showMissingKey,
}: {
  model: ModelSettings;
  onSetModel: (patch: Partial<ModelSettings>) => void;
  showMissingKey: boolean;
}) {
  const [open, setOpen] = useState(false);
  const backendId: LlmBackendId = useMemo(() => {
    const id = model.llmBackendId as LlmBackendId | undefined;
    if (id && LLM_BACKENDS.some((b) => b.id === id)) return id;
    return inferBackendIdFromBaseUrl(model.baseUrl) ?? "anthropic";
  }, [model.llmBackendId, model.baseUrl]);
  const backend = getLlmBackend(backendId);

  const modelLabel = model.model || backend.defaultModel;

  return (
    <div className="relative mb-1.5 px-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
          showMissingKey
            ? "border border-amber-400/25 bg-amber-500/8 hover:bg-amber-500/12"
            : "border border-[var(--color-border-subtle)] bg-[var(--color-fill)] hover:border-[var(--color-border)]",
        ].join(" ")}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${showMissingKey ? "bg-amber-400/70" : "bg-emerald-400/70"}`} />
        {showMissingKey ? (
          <span className="flex-1 text-[11px] text-amber-300/70">No API key — tap to connect LLM</span>
        ) : (
          <>
            <span className="text-[10px] text-[var(--color-fg-dim)]">{backend.providerLabel}</span>
            <span className="text-[var(--color-fg-dim)] opacity-30">·</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-fg-muted)]">{modelLabel}</span>
          </>
        )}
        <svg className="h-3 w-3 shrink-0 text-[var(--color-fg-dim)] opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 right-0 z-50 mb-1.5 max-h-[70vh] overflow-y-auto rounded-xl p-3 shadow-2xl"
          style={{ background: "var(--color-bg-sideBar)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <p className="mb-3 text-[11px] font-semibold text-[var(--color-fg)]">LLM settings</p>
          <LlmConnectCard
            model={model}
            onSave={(patch) => { onSetModel(patch); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main ChatPanel ───────────────────────────────────────────────────────────

export function ChatPanel() {
  const {
    model: globalModel,
    setModel,
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
    truncateMessagesAfter,
    clearChat,
    setComposerBusy,
    navigateChartToMint,
    chartAnalytics,
    selectedAlgoId,
    userAlgos,
    algoBlueprints,
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
    algoSessionActive,
    tradingHalted,
    scalperLiveBuySol,
    tradingSessions,
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
  const [appliedBackups, setAppliedBackups] = useState<Map<string, AppliedFileBackup[]>>(new Map());
  const [diffState, setDiffState] = useState<DiffState>(null);
  const [diffOriginal, setDiffOriginal] = useState<string | null>(null);
  const [diffLoading] = useState(false);
  void useState<WorkflowRunStatus | null | undefined>(undefined); // deployStatus removed — no longer shown in header
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [atMentionedPaths, setAtMentionedPaths] = useState<string[]>([]);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [localIdeAgentReady, setLocalIdeAgentReady] = useState(false);
  const [pendingBuildRequest, setPendingBuildRequest] = useState<string | null>(null);
  const [buildFlowState, setBuildFlowState] = useState<BuildFlowState>("chat");
  const [autoAppliedMessageIds, setAutoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  void Boolean(localWorkspaceHandle && workspaceReady && localIdeAgentReady); // chatLive badge removed from header

  const abortRef = useRef<AbortController | null>(null);
  const buildFlowStateRef = useRef<BuildFlowState>("chat");
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const isInitialFeedLayout = useRef(true);
  // true when the user has manually scrolled up mid-stream — stops auto-follow
  const userScrolledUpRef = useRef(false);
  const prevPendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function transitionBuildFlow(to: BuildFlowState) {
    const from = buildFlowStateRef.current;
    if (!canTransitionBuildFlow(from, to)) return;
    buildFlowStateRef.current = to;
    setBuildFlowState(to);
  }

  useEffect(() => {
    let cancelled = false;
    async function checkWorkspaceReady() {
      if (!localWorkspaceHandle) {
        setWorkspaceReady(false);
        return;
      }
      try {
        await readLocalFile(localWorkspaceHandle, "package.json");
        if (!cancelled) setWorkspaceReady(true);
      } catch {
        if (!cancelled) setWorkspaceReady(false);
      }
    }
    void checkWorkspaceReady();
    return () => { cancelled = true; };
  }, [localWorkspaceHandle]);

  useEffect(() => {
    let cancelled = false;
    async function checkLocalIdeAgent() {
      try {
        const res = await fetch("/__agent/status");
        if (!cancelled) setLocalIdeAgentReady(res.ok);
      } catch {
        if (!cancelled) setLocalIdeAgentReady(false);
      }
    }
    void checkLocalIdeAgent();
    const id = window.setInterval(() => void checkLocalIdeAgent(), 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

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

  // When a NEW user turn arrives, scroll to the bottom immediately so the
  // assistant response is visible from the start (not the user message top).
  useLayoutEffect(() => {
    const feed = feedScrollRef.current;
    if (!latestUserId || !feed) return;
    if (isInitialFeedLayout.current) { isInitialFeedLayout.current = false; return; }
    userScrolledUpRef.current = false;
    // Small rAF loop to let the DOM settle before scrolling
    let raf = 0; let cancelled = false; let frames = 0;
    const step = () => {
      if (cancelled) return;
      feed.scrollTop = feed.scrollHeight;
      frames += 1;
      if (frames < 4) raf = requestAnimationFrame(step);
    };
    feed.scrollTop = feed.scrollHeight;
    raf = requestAnimationFrame(step);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [latestUserId]);

  // While streaming, keep following the bottom — unless the user scrolled up.
  useEffect(() => {
    if (!pending || userScrolledUpRef.current) return;
    const feed = feedScrollRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
  }); // no dep array — runs after every render during streaming

  // Keep viewport pinned to latest answer when streaming completes.
  // Without this, post-stream UI (followups/apply buttons) can push content down
  // and make the view appear to jump upward right as typing ends.
  useEffect(() => {
    const feed = feedScrollRef.current;
    if (!feed) {
      prevPendingRef.current = pending;
      return;
    }

    const wasPending = prevPendingRef.current;
    if (wasPending && !pending && !userScrolledUpRef.current) {
      requestAnimationFrame(() => {
        const f = feedScrollRef.current;
        if (!f || userScrolledUpRef.current) return;
        f.scrollTop = f.scrollHeight;
      });
    }

    prevPendingRef.current = pending;
  }, [pending, messages.length]);

  // Detect manual upward scroll during streaming → stop auto-follow.
  // Detect scroll back to bottom → resume auto-follow.
  useEffect(() => {
    const feed = feedScrollRef.current;
    if (!feed) return;
    const onScroll = () => {
      const distFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
      if (distFromBottom > 80) {
        userScrolledUpRef.current = true;
      } else {
        userScrolledUpRef.current = false;
      }
    };
    feed.addEventListener("scroll", onScroll, { passive: true });
    return () => feed.removeEventListener("scroll", onScroll);
  }, []);

  // Keyboard ergonomics: pressing PageDown/End while feed is focused should
  // keep chat navigation smooth, especially during streaming updates.
  useEffect(() => {
    const feed = feedScrollRef.current;
    if (!feed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "End") {
        e.preventDefault();
        feed.scrollTop = feed.scrollHeight;
        userScrolledUpRef.current = false;
      }
    };
    feed.addEventListener("keydown", onKeyDown);
    return () => feed.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset on tab switch
  useEffect(() => { isInitialFeedLayout.current = true; userScrolledUpRef.current = false; }, [activeChatId]);

  // ── Apply helpers ─────────────────────────────────────────────────
  async function applyOne(
    path: string,
    code: string,
    targetMsgId?: string,
  ): Promise<string | null> {
    try {
      let previousContent: string | null = null;
      let existedBefore = false;
      // Capture pre-edit content so "Revert & Resend" can restore actual code.
      if (targetMsgId) {
        try {
          if (localWorkspaceHandle) {
            previousContent = await readLocalFile(localWorkspaceHandle, path);
            existedBefore = true;
          } else {
            const { token, owner, repo, branch } = githubWorkspace;
            if (token && owner && repo) {
              const result = await githubGetFileContent(token, owner, repo, branch || "main", path);
              previousContent = result.text;
              existedBefore = true;
            }
          }
        } catch {
          previousContent = null;
          existedBefore = false;
        }
      }

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
        setAppliedBackups((prev) => {
          const next = new Map(prev);
          const existing = next.get(targetMsgId) ?? [];
          if (!existing.some((b) => b.path === path)) {
            existing.push({ path, previousContent, existedBefore });
          }
          next.set(targetMsgId, existing);
          return next;
        });
      }
      return sha;
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  function handleApplyConfig(patch: ReturnType<typeof parseConfigPatch>) {
    if (!patch) return;
    setScalperUserConfig(patch);
  }

  async function rollbackLatestEdit() {
    if (!localIdeAgentReady || rollbackBusy) return;
    setRollbackBusy(true);
    setApplyError(null);
    try {
      const res = await fetch("/__agent/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "rollback_edit", input: {} }),
      });
      const data = await res.json() as { ok?: boolean; content?: string; error?: string };
      if (!res.ok || data.ok === false) {
        setApplyError(data.content ?? data.error ?? "Rollback failed.");
        return;
      }
      setApplyError(data.content ?? "Rolled back latest edit.");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setRollbackBusy(false);
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

  async function autoApplyCoreBuildArtifacts(messageId: string, content: string) {
    const artifacts = parseBuildArtifacts(content);
    if (!artifacts.validForApply || artifacts.edits.length === 0) return;
    await handleApplyAll(
      artifacts.edits.map((e) => ({ path: e.path, code: e.code })),
      messageId,
    );
    setAutoAppliedMessageIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }

  async function restoreBackupsForAssistantMessages(messageIds: string[]) {
    for (const msgId of messageIds) {
      const backups = appliedBackups.get(msgId);
      if (!backups || backups.length === 0) continue;
      for (const backup of backups) {
        if (backup.existedBefore && backup.previousContent != null) {
          await applyOne(backup.path, backup.previousContent);
        } else {
          // We currently do not support hard-delete in this flow.
          // Keep a visible warning so the user knows why a created file remains.
          setApplyError(
            `Revert warning: ${backup.path} was newly created, and automatic file deletion is not enabled. Remove it manually if needed.`,
          );
        }
      }
    }
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

  function stopGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setComposerBusy(false);
    transitionBuildFlow("chat");
  }

  async function send(
    textOverride?: string,
    priorOverride?: typeof messages,
    opts?: { forceBuild?: boolean },
  ) {
    const text = (textOverride ?? input).trim();
    if ((!text && attachedImages.length === 0) || pending) return;

    // Use priorOverride when provided (e.g. message edit path) so the API
    // receives the correctly-truncated history even before React flushes state.
    const prior = priorOverride ?? messages;
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

    const explicitBuildCommand = isExplicitBuildCommand(text);
    const confirmationYes = Boolean(
      pendingBuildRequest && (isBuildConfirmationYes(text) || explicitBuildCommand),
    );
    const confirmationNo = Boolean(pendingBuildRequest && isBuildConfirmationNo(text));
    if (confirmationNo) {
      setPendingBuildRequest(null);
      transitionBuildFlow("chat");
      updateMessage(assistantId, {
        content: "Got it — staying in chat mode. Tell me what you want to refine before we build.",
      });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }

    const taskText = confirmationYes && pendingBuildRequest ? pendingBuildRequest : text;
    if (confirmationYes) setPendingBuildRequest(null);
    const investigationIntent = isCodeInvestigationIntent(taskText);
    const explicitBuildIntent = isExplicitBuildCommand(taskText);
    const potentialBuildIntent = isPotentialBuildIntent(taskText) && !investigationIntent;
    const effectiveMode: ChatMode =
      (opts?.forceBuild || confirmationYes || explicitBuildIntent || investigationIntent)
        ? "build"
        : "chat";
    const capability = buildCapability({ localIdeAgentReady, localWorkspaceHandle, workspaceReady });
    const isAnthropicProvider = isAnthropicMessagesApiBaseUrl(model.baseUrl);
    if (potentialBuildIntent && !explicitBuildIntent && !confirmationYes && !opts?.forceBuild) {
      setPendingBuildRequest(taskText);
      transitionBuildFlow("build_confirm_pending");
      updateMessage(assistantId, {
        content:
          `Ready to build this now?\n\n` +
          `Reply **yes** to start build mode automatically, or **no** to keep planning in chat.`,
      });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }
    if (effectiveMode === "build") transitionBuildFlow("build_running");
    else transitionBuildFlow("chat");
    if (effectiveMode === "build" && !isAnthropicProvider) {
      transitionBuildFlow("build_failed");
      updateMessage(assistantId, {
        content:
          `Build is not available with ${model.providerLabel || "this model"} yet.\n\n` +
          "This provider can chat, but ALgoat's autonomous IDE tools are currently wired through Anthropic. Switch to an Anthropic model for file edits, or use Chat mode to keep blueprinting.",
      });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }
    if (effectiveMode === "build" && capability === "blocked") {
      transitionBuildFlow("build_failed");
      updateMessage(assistantId, {
        content: buildBlockedMessage(capability, Boolean(localWorkspaceHandle)),
      });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }
    const shouldUseCodeAgent =
      effectiveMode === "build" &&
      capability !== "blocked";

    // Fetch only files explicitly mentioned in the current message. Historical
    // auto-loading caused old file context to grow invisibly across turns.
    const allMentionedPaths = [
      ...new Set(atMentionedPaths),
    ].slice(0, 3);
    let mentionContext = "";
    if (allMentionedPaths.length > 0) {
      const noWorkspace = !localWorkspaceHandle && (!githubWorkspace.token || !githubWorkspace.owner || !githubWorkspace.repo);
      if (noWorkspace) {
        // Surface a clear error instead of silently dropping file context
        updateMessage(assistantId, {
          content: `⚠️ Can't read @-mentioned files — no workspace connected.\n\nTo include file contents in chat:\n- **Local (instant):** Setup → "Connect local workspace folder"\n- **GitHub:** Setup → paste PAT + owner/repo`,
        });
        setPending(false);
        setComposerBusy(false);
        abortRef.current = null;
        return;
      }
      const snippets: string[] = [];
      for (const p of allMentionedPaths) {
        if (abort.signal.aborted) break;
        try {
          let fileText: string;
          if (localWorkspaceHandle) {
            fileText = await readLocalFile(localWorkspaceHandle, p);
          } else {
            const { token, owner, repo, branch } = githubWorkspace;
            const result = await githubGetFileContent(token, owner, repo, branch || "main", p);
            fileText = result.text;
          }
          snippets.push(`### @${p}\n\`\`\`\n${fileText.slice(0, 4000)}\n\`\`\``);
        } catch { /* skip unreachable paths */ }
      }
      if (snippets.length) mentionContext = "\n\n## @mentioned files\n" + snippets.join("\n\n");
    }

    // Bail out cleanly if the user stopped during the mention fetch phase
    if (abort.signal.aborted) {
      updateMessage(assistantId, { content: "(stopped)" });
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      return;
    }

    // ── API grounding ────────────────────────────────────────────────
    // Do not preload a repo-wide exports digest. Build mode has search/read
    // tools; broad digests are the core source of rate-limit pressure.
    let apiSurfaceContext = "";
    let digestPaths: string[] = [];
    if (shouldUseCodeAgent) {
      apiSurfaceContext =
        "\n\n## Repo context policy\n" +
        "- Do not assume the full repo is in the prompt.\n" +
        "- Use search_code/list_files/read_file to retrieve only the files needed for this task.\n" +
        "- Prefer targeted retrieval over broad exploration.";
    }

    // Avoid using a generated repo digest as a fallback file tree.
    const effectiveFilePaths = workspaceFilePaths.length > 0 ? workspaceFilePaths : digestPaths;
    const includeTradingDetails = needsTradingContext(taskText);
    const includeWorkspaceDetails = needsWorkspaceContext(taskText);
    const includeOpenFile = includeWorkspaceDetails || allMentionedPaths.length > 0;

    const liveContext = buildLiveContext({
      chartAnalytics,
      selectedAlgoId,
      userAlgos,
      algoBlueprints,
      tradingMode,
      openFilePath,
      openFileContent,
      workspaceFilePaths: effectiveFilePaths,
      bounceZones,
      scalperUserConfig,
      algoSessionActive,
      tradingHalted,
      scalperLiveBuySol,
      tradingSessions,
    }, {
      includeTradingDetails,
      includeSessionDetails: includeTradingDetails,
      includeWorkspaceDetails,
      includeOpenFile,
    });
    const trimmedLiveContext = clipMiddle(liveContext, MAX_LIVE_CONTEXT_CHARS, "live context");

    const workspaceContext = shouldUseCodeAgent
      ? capability === "full-ide"
        ? `\n\n## Active local IDE agent\n- Status: enabled through Vite /__agent endpoints\n- Tools: read_file, write_file, list_files, search_code, run_typecheck, run_build\n- Scope: exact repo currently served by localhost/Vite\n- After meaningful edits, run_typecheck before claiming success.`
        : `\n\n## Active local workspace (write-only)\n- Folder: ${localWorkspaceHandle?.name ?? "connected workspace"}\n- Browser file tools: read_file, write_file, list_files\n- Not available in this mode: search_code, run_typecheck, run_build, DOM checks, console checks, rollback_edit\n- Make small, targeted edits and clearly say verification is limited to read-back.`
      : "\n\n## Active mode\n- Blueprint/chat mode: respond from the user's request and live app state only. Do not inspect files.";

    const systemContent =
      clipMiddle(
      buildComposerSystemPrompt(
        githubWorkspace,
        shouldUseCodeAgent
          ? investigationIntent && !explicitBuildIntent
            ? "Code investigation mode for this turn. Inspect/analyze code and explain findings. Do not propose or apply edits unless user explicitly asks to build."
            : "Build mode is bounded single-pass for this turn. Retrieved file context is injected by host; do not emit tool traces like <tool_call> or claim you are exploring."
          : "Blueprint/chat mode for this turn. Do not explore the codebase, do not call tools, and do not say you will inspect files. Help the user shape the algo idea into a concise blueprint/spec first. Only discuss implementation if the user explicitly asks to edit code or build it.",
        effectiveMode === "build" ? "build" : "chat",
      ) +
      "\n\n---\n" +
      trimmedLiveContext +
      workspaceContext +
      clipMiddle(apiSurfaceContext, MAX_REPO_POLICY_CHARS, "repo policy") +
      clipMiddle(mentionContext, MAX_MENTION_CONTEXT_CHARS, "@mentioned files"),
      MAX_ANTHROPIC_SYSTEM_CHARS,
      "system context",
    );
    const historyForRequest = trimHistoryByChars(
      [
        ...prior.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: taskText },
      ],
      MAX_ANTHROPIC_HISTORY_CHARS,
    );

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

        let effectiveSystemContent = systemContent;
        if (shouldUseCodeAgent && localWorkspaceHandle) {
          const retrievalSnippets: string[] = [];
          const listRes = await executeTool(
            { id: "prefetch-list", name: "list_files", input: { prefix: "src/" } },
            localWorkspaceHandle,
          );
          retrievalSnippets.push(
            "### list_files src/\n```\n" + clipMiddle(listRes, 1400, "list files") + "\n```",
          );

          if (capability === "full-ide") {
            const query = text.slice(0, 120);
            const searchRes = await executeTool(
              { id: "prefetch-search", name: "search_code", input: { query, prefix: "src/" } },
              localWorkspaceHandle,
            );
            retrievalSnippets.push(
              `### search_code: ${query}\n\`\`\`\n${clipMiddle(searchRes, 2200, "search results")}\n\`\`\``,
            );

            const pathMatches = Array.from(
              new Set(
                searchRes
                  .split("\n")
                  .map((line) => /^([^:\n]+):\d+:/.exec(line)?.[1])
                  .filter((p): p is string => Boolean(p)),
              ),
            ).slice(0, 3);

            for (const p of pathMatches) {
              const readRes = await executeTool(
                { id: `prefetch-read-${p}`, name: "read_file", input: { path: p } },
                localWorkspaceHandle,
              );
              retrievalSnippets.push(
                `### ${p}\n\`\`\`\n${clipMiddle(readRes, 2200, `${p} content`)}\n\`\`\``,
              );
            }
          }

          if (retrievalSnippets.length > 0) {
            effectiveSystemContent = clipMiddle(
              systemContent +
                "\n\n## Retrieved workspace context (deterministic prefetch)\n" +
                retrievalSnippets.join("\n\n"),
              MAX_ANTHROPIC_SYSTEM_CHARS,
              "system context",
            );
          }
        }

        let aBody = buildAnthropicMessagesBody({
          model: model.model,
          system: effectiveSystemContent,
          history: historyForRequest,
          stream: true,
          maxTokens: shouldUseCodeAgent ? ANTHROPIC_BUILD_MAX_TOKENS : ANTHROPIC_CHAT_MAX_TOKENS,
        });

        if (capturedImages.length > 0) {
          const msgs = aBody.messages as Array<{ role: string; content: unknown }>;
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0) {
            const last = msgs[lastIdx]!;
            const imageBlocks = capturedImages.map((url) => {
              const mimeMatch = url.match(/^data:([^;]+);base64,/);
              const mediaType = (mimeMatch?.[1] ?? "image/png") as string;
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: url.replace(/^data:[^;]+;base64,/, ""),
                },
              };
            });
            const patched = [...msgs];
            patched[lastIdx] = { ...last, content: [...imageBlocks, { type: "text", text: last.content }] };
            aBody = { ...aBody, messages: patched };
          }
        }

        const MAX_RETRIES = 2;
        const RETRY_DELAYS = [2_000, 5_000];
        let res: Response | null = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (abort.signal.aborted) return;
          if (attempt > 0) {
            const delay = RETRY_DELAYS[attempt - 1]!;
            setStatus(`*Anthropic returned 529 — retrying in ${delay / 1000}s… (${attempt}/${MAX_RETRIES})*`);
            await new Promise<void>((resolve, reject) => {
              const tid = window.setTimeout(resolve, delay);
              abort.signal.addEventListener("abort", () => { window.clearTimeout(tid); reject(); }, { once: true });
            }).catch(() => undefined);
            if (abort.signal.aborted) return;
          }
          const connDeadline = new AbortController();
          const connTid = window.setTimeout(
            () => connDeadline.abort(new DOMException("Anthropic first-byte timeout (20 s)", "AbortError")),
            20_000,
          );
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
          if (res.status !== 529) break;
          if (attempt < MAX_RETRIES) await res.body?.cancel();
        }

        if (!res) return;
        if (!res.ok) {
          const errRaw = await res.text().catch(() => `HTTP ${res.status}`);
          let errMsg = errRaw.slice(0, 500);
          try {
            const j = JSON.parse(errRaw) as { error?: { message?: string } };
            if (j.error?.message) errMsg = j.error.message;
          } catch { /* keep raw */ }
          const hint =
            res.status === 401 ? "\n\n**Fix:** Check your Anthropic API key."
            : res.status === 429 ? "\n\n**Input rate limit hit.** Request context is still too large for current TPM."
            : res.status === 529 ? "\n\nAnthropic is overloaded for this route. Retry shortly."
            : res.status === 402 ? "\n\n**Fix:** Add credits at [console.anthropic.com/billing](https://console.anthropic.com/billing)."
            : "\n\nCheck model name, billing, and [Anthropic status](https://status.anthropic.com).";
          setStatus(`**Anthropic error ${res.status}:** ${errMsg}${hint}`);
          if (effectiveMode === "build") transitionBuildFlow("build_failed");
          return;
        }

        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/event-stream")) {
          let acc = "";
          setStatus("\u200B");
          await consumeAnthropicMessageStream(res.body, (chunk) => {
            acc += chunk;
            updateMessage(assistantId, { content: stripToolTraceTags(acc) });
          }, { signal: abort.signal, idleMs: 30_000 });
          if (acc.trim()) {
            const cleaned = stripToolTraceTags(acc);
            if (effectiveMode === "build") {
              transitionBuildFlow("build_verifying");
              const artifacts = parseBuildArtifacts(cleaned);
              if (artifacts.validForApply) {
                await autoApplyCoreBuildArtifacts(assistantId, cleaned);
                transitionBuildFlow("build_done");
              } else transitionBuildFlow("build_failed");
            }
            updateMessage(assistantId, { content: cleaned });
          }
          if (!acc.trim()) setStatus("(empty response — check model id and Anthropic status)");
          return;
        }

        const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        const txt = data.content?.find((c) => c.type === "text")?.text?.trim() || "";
        const cleaned = stripToolTraceTags(txt) || "(empty response)";
        if (effectiveMode === "build") {
          transitionBuildFlow("build_verifying");
          const artifacts = parseBuildArtifacts(cleaned);
          if (artifacts.validForApply) {
            await autoApplyCoreBuildArtifacts(assistantId, cleaned);
            transitionBuildFlow("build_done");
          } else transitionBuildFlow("build_failed");
        }
        setStatus(cleaned);
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
        headers["X-Title"] = import.meta.env.VITE_OPENROUTER_APP_TITLE || "ALgoat";
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
              ...historyForRequest.map((m, i) => {
                if (i === historyForRequest.length - 1 && m.role === "user" && capturedImages.length > 0) {
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
        if (effectiveMode === "build") transitionBuildFlow("build_failed");
        return;
      }
      if (ct.includes("text/event-stream")) {
        let acc = "";
        setStatus("\u200B");
        await consumeChatCompletionStream(res.body, (chunk) => {
          acc += chunk;
          updateMessage(assistantId, { content: stripToolTraceTags(acc) });
        });
        if (acc.trim()) {
          const cleaned = stripToolTraceTags(acc);
          if (effectiveMode === "build") {
            transitionBuildFlow("build_verifying");
            const artifacts = parseBuildArtifacts(cleaned);
            if (artifacts.validForApply) {
              await autoApplyCoreBuildArtifacts(assistantId, cleaned);
              transitionBuildFlow("build_done");
            } else transitionBuildFlow("build_failed");
          }
          updateMessage(assistantId, { content: cleaned });
        }
        if (!acc.trim()) setStatus("(empty response — check model name and API key)");
        return;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const cleaned = stripToolTraceTags(data.choices?.[0]?.message?.content?.trim() || "") || "(empty response)";
      if (effectiveMode === "build") {
        transitionBuildFlow("build_verifying");
        const artifacts = parseBuildArtifacts(cleaned);
        if (artifacts.validForApply) {
          await autoApplyCoreBuildArtifacts(assistantId, cleaned);
          transitionBuildFlow("build_done");
        } else transitionBuildFlow("build_failed");
      }
      setStatus(cleaned);
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
        if (effectiveMode === "build") transitionBuildFlow("build_failed");
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
      if (effectiveMode === "build") transitionBuildFlow("build_failed");
    } finally {
      abortRef.current = null;
      setPending(false);
      setComposerBusy(false);
      if (effectiveMode !== "build") transitionBuildFlow("chat");
    }
  }

  async function copyMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((x) => (x === id ? null : x)), 1500);
    } catch { /* ignore */ }
  }

  const CHAT_LOCK_MS = 3 * 60 * 1000; // re-lock every 3 minutes
  const [chatUnlocked, setChatUnlocked] = useState(() => {
    try {
      const ts = Number(localStorage.getItem("unt_chat_unlocked_ts_v1") ?? "0");
      return ts > 0 && Date.now() - ts < CHAT_LOCK_MS;
    } catch { return false; }
  });

  // Auto-relock after 3 minutes
  useEffect(() => {
    if (!chatUnlocked) return;
    const tid = window.setTimeout(() => setChatUnlocked(false), CHAT_LOCK_MS);
    return () => window.clearTimeout(tid);
  }, [chatUnlocked]);

  function unlockChat() {
    setChatUnlocked(true);
    try { localStorage.setItem("unt_chat_unlocked_ts_v1", String(Date.now())); } catch { /* ignore */ }
  }

  return (
    <div
      id="chat-panel"
      className="relative flex h-full min-h-0 min-w-[300px] flex-col"
      style={{ background: "var(--color-bg-editor)", borderLeft: "1px solid var(--color-border)" }}
    >
      {!chatUnlocked && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black px-8 text-center">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
              Work in progress
            </p>
            <h2 className="text-[22px] font-bold leading-snug text-white">
              The Chat is still in Beta
            </h2>
            <p className="text-[13px] leading-relaxed text-[rgba(255,255,255,0.45)]">
              Code changes generated here may break the app.
            </p>
          </div>
          <button
            type="button"
            onClick={unlockChat}
            className="rounded-xl border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.07)] px-8 py-3 text-[13px] font-semibold text-white transition-all hover:bg-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.28)] active:scale-[0.97]"
          >
            Proceed
          </button>
        </div>
      )}
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
          {/* LLM connection status line */}
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={"size-1.5 shrink-0 rounded-full " + (model.apiKey.trim() ? "bg-emerald-400" : "bg-[var(--color-fg-dim)]")}
              title={model.apiKey.trim() ? "LLM connected" : "No API key — add one below"}
            />
            <p className="truncate font-mono text-[10px] leading-snug text-[var(--color-fg-dim)]" title={`${model.providerLabel} · ${model.model}`}>
              {model.apiKey.trim() ? `${model.providerLabel} · ${model.model}` : "Not connected — paste API key below"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Build state — only shown when active */}
          {buildFlowState !== "chat" && (
            <span
              className={
                "mr-1 rounded-lg border px-2.5 py-1 text-[10px] font-semibold " +
                (buildFlowState === "build_running" || buildFlowState === "build_verifying"
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-300/85"
                  : buildFlowState === "build_done"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300/85"
                    : buildFlowState === "build_failed"
                      ? "border-red-500/30 bg-red-500/10 text-red-300/85"
                      : "border-cyan-500/25 bg-cyan-500/10 text-cyan-300/85")
              }
            >
              {buildFlowState === "build_running" && "Building…"}
              {buildFlowState === "build_verifying" && "Verifying…"}
              {buildFlowState === "build_done" && "Build done"}
              {buildFlowState === "build_failed" && "Build failed"}
              {buildFlowState === "build_confirm_pending" && "Confirm build?"}
            </span>
          )}
          {activeSession?.modelOverride ? (
            <button
              type="button"
              title="Reset to global model"
              onClick={() => clearSessionModel(activeChatId)}
              className="rounded-lg px-2 py-1.5 text-[10px] text-amber-400/70 hover:bg-[var(--color-fill)] hover:text-amber-400"
            >
              custom ×
            </button>
          ) : null}
          {localIdeAgentReady ? (
            <button
              type="button"
              title="Rollback latest local IDE edit"
              onClick={() => void rollbackLatestEdit()}
              disabled={rollbackBusy}
              className="rounded-lg px-2 py-1.5 text-[10px] text-[var(--color-fg-dim)] hover:bg-[var(--color-fill)] hover:text-[var(--color-fg-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {rollbackBusy ? "rolling…" : "rollback"}
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
        tabIndex={0}
        className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-4 py-4"
      >
        <StandaloneAssistantIntro messages={leadingAssistants} copiedId={copiedId} onCopy={copyMessage} />
        {leadingAssistants.length === 0 && turns.length === 0 ? (
          <ChatEmptyState
            showMissingKeyBanner={showMissingKeyBanner}
            localWorkspaceConnected={localWorkspaceHandle !== null}
            githubWired={Boolean(githubWorkspace.owner && githubWorkspace.repo)}
            model={model}
            onSetModel={setModel}
            onSend={(text) => void send(text)}
          />
        ) : null}
        {turns.map((turn, idx) => (
          <ChatTurnSection
            key={turn.user.id}
            turn={turn}
            isLatestTurn={idx === turns.length - 1}
            pending={pending}
            buildFlowState={buildFlowState}
            autoApplied={Boolean(turns[idx]?.assistant?.id && autoAppliedMessageIds.has(turns[idx]!.assistant!.id))}
            copiedId={copiedId}
            commitResults={commitResults}
            githubWorkspace={githubWorkspace}
            onCopy={copyMessage}
            onApplyAll={(edits) => void handleApplyAll(edits, turns[idx]?.assistant?.id)}
            onAddAlgo={addUserAlgo}
            onApplyConfig={handleApplyConfig}
            onSend={(text) => void send(text)}
            onEdit={(userMsgId, newText) => {
              // Compute the prior synchronously from current messages before
              // truncation flushes, so the API gets the correct history.
              const idx = messages.findIndex((m) => m.id === userMsgId);
              const priorBeforeEdit = idx >= 0 ? messages.slice(0, idx) : messages;
              const removedMsgs = idx >= 0 ? messages.slice(idx) : [];
              const removedIds = new Set(removedMsgs.map((m) => m.id));
              const removedAssistantIds = removedMsgs.filter((m) => m.role === "assistant").map((m) => m.id);
              void (async () => {
                setApplyError(null);
                await restoreBackupsForAssistantMessages(removedAssistantIds);
                setCommitResults((prev) => {
                  const next = new Map(prev);
                  for (const id of removedIds) next.delete(id);
                  return next;
                });
                setAppliedBackups((prev) => {
                  const next = new Map(prev);
                  for (const id of removedIds) next.delete(id);
                  return next;
                });
                setAutoAppliedMessageIds((prev) => {
                  const next = new Set(prev);
                  for (const id of removedIds) next.delete(id);
                  return next;
                });
                setDiffState(null);
                setDiffOriginal(null);
                truncateMessagesAfter(userMsgId);
                await send(newText, priorBeforeEdit);
              })();
            }}
            onDismissCommit={(msgId) => setCommitResults((prev) => { const next = new Map(prev); next.delete(msgId); return next; })}
            onLoadMint={navigateChartToMint}
          />
        ))}
      </div>

      {/* ── Composer ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        {/* ── Local workspace status ────────────────────────────── */}
        {localWorkspaceHandle ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,#22d3ee_20%,transparent)] bg-[color-mix(in_srgb,#22d3ee_5%,transparent)] px-3 py-1.5 text-[11px]">
            <span className="size-1.5 shrink-0 rounded-full bg-cyan-400/80" />
            <span className="text-cyan-300/70">Local workspace connected — edits write to disk instantly</span>
          </div>
        ) : null}
        {/* Status banners */}
        {applyingPaths.length > 0 ? (
          <div className="mb-2 flex items-center gap-2 px-1 text-[11.5px] text-[var(--color-fg-dim)]">
            <Loader2 className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
            {localWorkspaceHandle ? "Writing" : "Applying"} {applyingPaths.join(", ")}…
          </div>
      ) : buildFlowState === "build_running" || buildFlowState === "build_verifying" ? (
        <div className="mb-2 flex items-center gap-2 px-1 text-[11.5px] text-[var(--color-fg-dim)]">
          <Loader2 className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
          {buildFlowState === "build_running" ? "Build running…" : "Verifying build artifacts…"}
        </div>
        ) : applyError ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11.5px] text-red-400/80">
            {applyError}
            <button type="button" onClick={() => setApplyError(null)} className="ml-auto shrink-0 underline opacity-70 hover:opacity-100">dismiss</button>
          </div>
        ) : null}

        {/* Model footer — always visible; click to edit LLM settings */}
        <ModelFooterBar model={model} onSetModel={setModel} showMissingKey={showMissingKeyBanner} />

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
