import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import { useApp } from "@/context/AppContext";
import { getStoredSolanaRpcUrl, setStoredSolanaRpcUrl, getSolanaRpcUrl } from "@/lib/solanaRpc";
import { PumpPortalWalletFundingBadge } from "@/components/PumpPortalWalletFundingBadge";
import { usePumpPortalLinkedWalletSol } from "@/hooks/usePumpPortalLinkedWalletSol";
import {
  getPumpPortalWsMode,
  getStoredPumpPortalApiKey,
  getStoredPumpPortalTradingWalletSecret,
  setStoredPumpPortalApiKey,
  setStoredPumpPortalTradingWalletSecret,
} from "@/lib/pumpPortalConfig";
import { tryPubkeyFromSolanaWalletSecret } from "@/lib/solanaWalletSecret";
import { refreshPumpPortalSocket } from "@/lib/pumpPortalRealtime";
import {
  type LlmBackendId,
  LLM_BACKENDS,
  getLlmBackend,
  inferBackendIdFromBaseUrl,
  inferLlmBackendIdFromApiKey,
} from "@/lib/llmBackends";
import { fetchOpenAiCompatibleModelList } from "@/lib/fetchLlmModels";
import { githubForkUpstreamIntoViewerAccount } from "@/lib/githubApi";
import { getDefaultGithubUpstream } from "@/lib/githubUpstreamDefaults";
import { computeSetupSteps } from "@/lib/setupProgress";
import { isFileSystemAccessSupported } from "@/lib/localWorkspace";

const PORTAL_SETUP_URL = "https://pumpportal.fun/trading-api/setup";

/** Left bar + soft tint — green when step satisfied, red when not. */
function setupStepWrapClass(ok: boolean, extra?: string): string {
  const accent =
    "rounded-lg border-l-[3px] border-solid py-2 pl-3 pr-2 " +
    (ok ? "border-l-emerald-500/85 bg-emerald-500/[0.06]" : "border-l-red-500/75 bg-red-500/[0.07]");
  return extra ? `${accent} ${extra}` : accent;
}

function setupSectionCardClass(ok: boolean): string {
  return (
    "unt-section-card space-y-4 border-l-[3px] border-solid " +
    (ok ? "border-l-emerald-500/85" : "border-l-red-500/75")
  );
}

export function SetupPanel() {
  const rev = usePumpPortalConfigRevision();
  const { model, setModel, githubWorkspace, setGithubWorkspace, localWorkspaceHandle, connectLocalWorkspace, disconnectLocalWorkspace } = useApp();

  const [draftPumpKey, setDraftPumpKey] = useState(getStoredPumpPortalApiKey);
  const [draftTradingWalletSecret, setDraftTradingWalletSecret] = useState(getStoredPumpPortalTradingWalletSecret);
  const [draftLlmKey, setDraftLlmKey] = useState(model.apiKey);
  const [draftRpcUrl, setDraftRpcUrl] = useState(getStoredSolanaRpcUrl);
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const upstreamForkTarget = useMemo(() => getDefaultGithubUpstream(), []);
  const [githubAssistBusy, setGithubAssistBusy] = useState<null | "login" | "fork">(null);
  const [githubAssistErr, setGithubAssistErr] = useState<string | null>(null);
  const [localWsErr, setLocalWsErr] = useState<string | null>(null);
  const [localWsBusy, setLocalWsBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Latest PumpPortal draft — used to flush to localStorage when Setup unmounts (sidebar tab switch). */
  const draftPumpKeyRef = useRef(draftPumpKey);
  draftPumpKeyRef.current = draftPumpKey;

  const draftTradingWalletSecretRef = useRef(draftTradingWalletSecret);
  draftTradingWalletSecretRef.current = draftTradingWalletSecret;

  /** Latest LLM API key draft — synced into chat context so Send works without pressing Save first. */
  const draftLlmKeyRef = useRef(draftLlmKey);
  draftLlmKeyRef.current = draftLlmKey;

  useEffect(() => {
    setDraftPumpKey(getStoredPumpPortalApiKey());
    setDraftTradingWalletSecret(getStoredPumpPortalTradingWalletSecret());
  }, [rev]);

  const derivedTradingPubkey = useMemo(
    () => tryPubkeyFromSolanaWalletSecret(draftTradingWalletSecret),
    [draftTradingWalletSecret],
  );

  const pubkeyForPortalBalance = derivedTradingPubkey;

  const { sol: portalWalletSol, loading: portalWalletSolLoading } =
    usePumpPortalLinkedWalletSol(pubkeyForPortalBalance);

  useEffect(() => {
    setDraftLlmKey(model.apiKey);
  }, [model.apiKey]);

  /** Persist PumpPortal key while typing (sidebar unmount would otherwise lose unsaved input). */
  useEffect(() => {
    const trimmed = draftPumpKey.trim();
    const stored = getStoredPumpPortalApiKey().trim();
    if (trimmed === stored) return;

    const t = window.setTimeout(() => {
      const next = draftPumpKeyRef.current.trim();
      if (next === getStoredPumpPortalApiKey().trim()) return;
      setStoredPumpPortalApiKey(draftPumpKeyRef.current);
      refreshPumpPortalSocket();
    }, 400);

    return () => window.clearTimeout(t);
  }, [draftPumpKey]);

  /** Persist trading-wallet secret for SOL balance chip (Setup + top bar). */
  useEffect(() => {
    const trimmed = draftTradingWalletSecret.trim();
    const stored = getStoredPumpPortalTradingWalletSecret().trim();
    if (trimmed === stored) return;

    const t = window.setTimeout(() => {
      const next = draftTradingWalletSecretRef.current.trim();
      if (next === getStoredPumpPortalTradingWalletSecret().trim()) return;
      setStoredPumpPortalTradingWalletSecret(next);
    }, 400);

    return () => window.clearTimeout(t);
  }, [draftTradingWalletSecret]);

  useEffect(() => {
    return () => {
      const next = draftPumpKeyRef.current.trim();
      if (next === getStoredPumpPortalApiKey().trim()) return;
      setStoredPumpPortalApiKey(draftPumpKeyRef.current);
      refreshPumpPortalSocket();
    };
  }, []);

  useEffect(() => {
    return () => {
      const next = draftTradingWalletSecretRef.current.trim();
      if (next === getStoredPumpPortalTradingWalletSecret().trim()) return;
      setStoredPumpPortalTradingWalletSecret(next);
    };
  }, []);

  const modelApiKeyRef = useRef(model.apiKey);
  modelApiKeyRef.current = model.apiKey;

  /** Push LLM key into AppContext immediately so chat never sends with a stale key. */
  useEffect(() => {
    if (draftLlmKey === model.apiKey) return;
    setModel({ apiKey: draftLlmKey });
  }, [draftLlmKey, model.apiKey, setModel]);

  useEffect(() => {
    return () => {
      const next = draftLlmKeyRef.current.trim();
      if (next === modelApiKeyRef.current.trim()) return;
      setModel({ apiKey: draftLlmKeyRef.current });
    };
  }, [setModel]);

  /** Guess issuer from pasted key and switch backend when it clearly belongs elsewhere. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const inferred = inferLlmBackendIdFromApiKey(draftLlmKey);
      if (!inferred) return;
      const currentId =
        (model.llmBackendId as LlmBackendId | undefined) ||
        inferBackendIdFromBaseUrl(model.baseUrl) ||
        "openai";
      if (inferred === currentId) return;
      const b = getLlmBackend(inferred);
      setModel({
        llmBackendId: inferred,
        providerLabel: b.providerLabel,
        baseUrl: b.baseUrl,
        model: b.defaultModel,
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [draftLlmKey, model.llmBackendId, model.baseUrl, setModel]);

  const backendIdResolved = useMemo((): LlmBackendId => {
    const id = model.llmBackendId as LlmBackendId | undefined;
    if (id && LLM_BACKENDS.some((b) => b.id === id)) return id;
    return inferBackendIdFromBaseUrl(model.baseUrl) ?? "openai";
  }, [model.llmBackendId, model.baseUrl]);

  const backend = getLlmBackend(backendIdResolved);

  useEffect(() => {
    let alive = true;
    if (!backend.fetchModelsList || !draftLlmKey.trim()) {
      setRemoteModels(null);
      setModelsLoading(false);
      return () => {
        alive = false;
      };
    }
    setModelsLoading(true);
    setRemoteModels(null);
    void fetchOpenAiCompatibleModelList(backend.baseUrl, draftLlmKey, backend.staticModels).then((ids) => {
      if (!alive) return;
      setModelsLoading(false);
      setRemoteModels(ids);
    });
    return () => {
      alive = false;
    };
  }, [backend.baseUrl, backend.fetchModelsList, backend.staticModels, draftLlmKey]);

  const displayModels = useMemo(() => {
    if (remoteModels?.length) return remoteModels;
    return backend.staticModels;
  }, [remoteModels, backend.staticModels]);

  const modelSelectOptions = useMemo(() => {
    const m = model.model;
    if (m && !displayModels.includes(m)) {
      return [m, ...displayModels];
    }
    return displayModels;
  }, [displayModels, model.model]);

  const inferredFromKey = inferLlmBackendIdFromApiKey(draftLlmKey);
  const pumpPortalWsMode = getPumpPortalWsMode();

  const setupSteps = useMemo(() => computeSetupSteps(model, githubWorkspace), [model, githubWorkspace, rev]);

  const portalApiComplete = useMemo(() => {
    if (draftPumpKey.trim().length > 0) return true;
    return setupSteps.pumpPortal;
  }, [draftPumpKey, setupSteps.pumpPortal]);

  const portalWalletComplete = useMemo(() => {
    if (derivedTradingPubkey != null) return true;
    if (draftTradingWalletSecret.trim().length > 0) return false;
    return setupSteps.pumpPortalWallet;
  }, [derivedTradingPubkey, draftTradingWalletSecret, setupSteps.pumpPortalWallet]);

  const applyBackend = (id: LlmBackendId) => {
    const b = getLlmBackend(id);
    setModel({
      llmBackendId: id,
      providerLabel: b.providerLabel,
      baseUrl: b.baseUrl,
      model: b.defaultModel,
    });
  };


  async function githubAssistForkConnect() {
    const t = githubWorkspace.token.trim();
    if (!t) {
      setGithubAssistErr("Paste a PAT first.");
      return;
    }
    setGithubAssistErr(null);
    setGithubAssistBusy("fork");
    try {
      const next = await githubForkUpstreamIntoViewerAccount({
        token: t,
        upstreamOwner: upstreamForkTarget.owner,
        upstreamRepo: upstreamForkTarget.repo,
      });
      setGithubWorkspace({
        owner: next.owner,
        repo: next.repo,
        branch: next.branch,
      });
    } catch (e) {
      setGithubAssistErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGithubAssistBusy(null);
    }
  }

  function handleSave() {
    // Flush all drafts immediately (auto-save already does this debounced;
    // the explicit Save button commits them right now).
    setStoredPumpPortalApiKey(draftPumpKey);
    refreshPumpPortalSocket();
    setStoredPumpPortalTradingWalletSecret(draftTradingWalletSecret);
    setStoredSolanaRpcUrl(draftRpcUrl);
    setModel({ apiKey: draftLlmKey });

    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2200);
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--color-bg-sideBar)" }}
    >
      <div className="min-h-0 flex-1 unt-panel-inner overflow-y-auto">
        <p className="unt-callout">
          <span className="font-semibold text-[var(--color-fg-heading)]">Privacy:</span> API keys and tokens stay in{" "}
          <span className="text-[var(--color-fg-heading)]">this browser only</span> (localStorage). They load again after refresh.
          They are not uploaded to this app&apos;s servers — only sent from your browser to PumpPortal, your LLM provider,
          and GitHub when you use those features.
        </p>

        <section className="unt-section-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-3">
            <h2 className="unt-section-title">PumpPortal · live trades</h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <PumpPortalWalletFundingBadge
                sol={portalWalletSol}
                loading={portalWalletSolLoading}
                hasPubkey={pubkeyForPortalBalance != null}
              />
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " +
                  (pumpPortalWsMode === "api-key"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pumpPortalWsMode === "public-only"
                      ? "bg-amber-500/15 text-amber-200"
                      : "bg-[var(--color-fill)] text-[var(--color-fg-dim)]")
                }
                title={
                  pumpPortalWsMode === "public-only"
                    ? "VITE_PUMPPORTAL_WS_PUBLIC_ONLY is set — the socket connects without your API key."
                    : pumpPortalWsMode === "api-key"
                      ? "PumpPortal websocket uses your saved API key."
                      : "No API key on the websocket URL yet."
                }
              >
                {pumpPortalWsMode === "api-key" ? "On" : pumpPortalWsMode === "public-only" ? "Public WS" : "Off"}
              </span>
            </div>
          </div>
          {pumpPortalWsMode === "public-only" ? (
            <p className="text-[11px] leading-snug text-amber-400/90">
              <span className="font-medium text-amber-200/95">Public websocket mode</span> (
              <code className="rounded bg-[var(--color-fill)] px-1 py-px font-mono text-[10px]">
                VITE_PUMPPORTAL_WS_PUBLIC_ONLY
              </code>
              ): your API key is saved but not appended to the socket — unset it and restart dev to show On.
            </p>
          ) : null}
          <p className="unt-body-text">
            Get your API key and trading wallet at{" "}
            <a
              href={PORTAL_SETUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#2EA8FF] underline underline-offset-2 hover:brightness-125"
            >
              pumpportal.fun/trading-api/setup ↗
            </a>
            . Keep ~0.02 SOL there for live streams.
          </p>
          <div className={setupStepWrapClass(portalApiComplete)}>
            <label className="unt-field-label">PumpPortal API key</label>
            <input
              type="password"
              autoComplete="off"
              value={draftPumpKey}
              onChange={(e) => setDraftPumpKey(e.target.value)}
              placeholder="Paste key…"
              className="unt-input w-full font-mono text-[13px]"
              aria-label="PumpPortal API key"
            />
          </div>
          <div className={setupStepWrapClass(portalWalletComplete, "mt-4")}>
            <label className="unt-field-label block">PumpPortal wallet private key</label>
            <input
              type="password"
              spellCheck={false}
              autoComplete="off"
              value={draftTradingWalletSecret}
              onChange={(e) => setDraftTradingWalletSecret(e.target.value)}
              placeholder="Paste your PumpPortal trading wallet secret (base58 or JSON byte array)"
              className="unt-input w-full font-mono text-[13px]"
              aria-label="PumpPortal wallet private key"
            />
            {draftTradingWalletSecret.trim() && !derivedTradingPubkey ? (
              <p className="unt-help-text mt-1.5 text-amber-400/90">
                Could not derive an address — use base58 or a JSON array of numbers (Phantom export).
              </p>
            ) : null}
            {derivedTradingPubkey ? (
              <p className="unt-help-text mt-1.5 font-mono text-[10px] text-[var(--color-fg-dim)]">
                Derived address: {derivedTradingPubkey}
              </p>
            ) : null}
            <p className="unt-help-text mt-1.5">
              Stored in this browser only. Use the same keypair you linked on PumpPortal — Lightning trades execute from that wallet.
            </p>
          </div>
          <p className="unt-help-text mt-2 border-t border-[var(--color-border-subtle)] pt-3 font-mono text-[10px] leading-relaxed text-[var(--color-fg-dim)]">
            Debug websocket frames: DevTools console →{" "}
            <code className="rounded bg-[var(--color-fill)] px-1 py-px">
              localStorage.setItem(&quot;unt_debug_pumpportal_ws&quot;,&quot;1&quot;)
            </code>{" "}
            → reload chart → watch{" "}
            <code className="rounded bg-[var(--color-fill)] px-1 py-px">[PumpPortal WS]</code> logs. Turn off:{" "}
            <code className="rounded bg-[var(--color-fill)] px-1 py-px">
              localStorage.removeItem(&quot;unt_debug_pumpportal_ws&quot;)
            </code>
            .
          </p>
        </section>

        <section className={setupSectionCardClass(setupSteps.llm)}>
          <div>
            <h2 className="unt-section-title">Algo assistant</h2>
            <p className="unt-help-text mt-2">
              Provider keys and model id — everything saves in this browser as you type.
            </p>
          </div>
          <p className="unt-body-text border-t border-[var(--color-border-subtle)] pt-4">
            Paste your provider API key — we <span className="text-[var(--color-fg)]">guess the host</span> from common
            patterns (Anthropic <code className="font-mono text-[11px]">sk-ant-…</code>, OpenRouter{" "}
            <code className="font-mono text-[11px]">sk-or-v1-…</code>, OpenAI{" "}
            <code className="font-mono text-[11px]">sk-proj-…</code>, Groq <code className="font-mono text-[11px]">gsk_…</code>
            , Google <code className="font-mono text-[11px]">AIza…</code>). Override{" "}
            <span className="text-[var(--color-fg)]">API provider</span> if needed, then pick the{" "}
            <span className="text-[var(--color-fg)]">model</span>.
          </p>

          <div>
            <label className="unt-field-label">
              LLM API key
            </label>
            <input
              type="password"
              autoComplete="off"
              value={draftLlmKey}
              onChange={(e) => setDraftLlmKey(e.target.value)}
              placeholder="API key (Anthropic, OpenAI, OpenRouter, Groq, …)"
              className="unt-input w-full font-mono text-[13px]"
              aria-label="LLM API key"
            />
            {inferredFromKey ? (
              <p className="unt-help-text mt-1.5">
                Detected from key:{" "}
                <span className="text-[var(--color-fg-muted)]">{getLlmBackend(inferredFromKey).label}</span>
                {inferredFromKey === backendIdResolved ? "" : " — waits for auto-switch after paste."}
              </p>
            ) : draftLlmKey.trim().length > 12 ? (
              <p className="unt-help-text mt-1.5">
                Could not infer provider from this key — choose <span className="text-[var(--color-fg-muted)]">API provider</span>{" "}
                manually (e.g. Mistral, Together).
              </p>
            ) : null}
          </div>

          <div>
            <label className="unt-field-label">API provider</label>
            <select
              value={backendIdResolved}
              onChange={(e) => applyBackend(e.target.value as LlmBackendId)}
              className="unt-input h-[40px] w-full py-0 pl-2 pr-8 text-[13px]"
              aria-label="LLM API provider"
            >
              {LLM_BACKENDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <p className="unt-help-text mt-1.5 font-mono text-[10px]">
              Base URL: <span className="text-[var(--color-fg-muted)]">{backend.baseUrl}</span>
            </p>
          </div>

          <div>
            <label className="unt-field-label">
              Model {modelsLoading ? "(loading list…)" : null}
            </label>
            <select
              value={modelSelectOptions.includes(model.model) ? model.model : backend.defaultModel}
              onChange={(e) => setModel({ model: e.target.value })}
              className="unt-input h-[40px] w-full py-0 pl-2 pr-8 text-[13px]"
              aria-label="LLM model id"
            >
              {modelSelectOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <p className="unt-help-text mt-1.5">
              OpenRouter/OpenAI/Groq/etc. may expose extra models via <code className="font-mono text-[10px]">/v1/models</code>{" "}
              when your key is valid; otherwise you see the curated list above.
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-fill)] p-4 space-y-3 border-l-[3px] border-l-[var(--color-border-subtle)]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="unt-section-title">Solana RPC</h2>
            <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-dim)]">
              optional · not counted in 4/4
            </span>
          </div>
          <p className="unt-help-text">
            Three things call the Solana RPC: <strong className="text-[var(--color-fg-muted)]">token supply</strong> (accurate MC axis on the chart),{" "}
            <strong className="text-[var(--color-fg-muted)]">wallet SOL balance</strong> (the balance chip in Setup), and{" "}
            <strong className="text-[var(--color-fg-muted)]">trade confirmation</strong> (polling for buy/sell on-chain status after a Lightning trade).
            The default public endpoint is rate-limited and blocks browser origins — paste a free{" "}
            <a href="https://helius.dev" target="_blank" rel="noreferrer" className="font-medium text-[#2EA8FF] underline-offset-2 hover:underline">Helius</a>{" "}
            or any mainnet RPC URL to keep all three working reliably.
          </p>
          <div>
            <label className="unt-field-label">RPC URL</label>
            <input
              type="url"
              value={draftRpcUrl}
              onChange={(e) => {
                setDraftRpcUrl(e.target.value);
                setStoredSolanaRpcUrl(e.target.value);
              }}
              placeholder="https://mainnet.helius-rpc.com/?api-key=…"
              className="unt-input w-full font-mono text-[12px]"
              aria-label="Solana RPC URL"
            />
            <p className="unt-help-text mt-1.5">
              Active: <span className="font-mono text-[10px] text-[var(--color-fg-muted)]">{getSolanaRpcUrl()}</span>
            </p>
          </div>
        </section>

        <section className={setupSectionCardClass(setupSteps.github)}>
          <div>
            <h2 className="unt-section-title">GitHub · Code &amp; Apply</h2>
            <p className="unt-help-text mt-2">
              Personal access token plus fork wiring for the Code sidebar and chat file applies.
            </p>
          </div>
          <p className="unt-body-text border-t border-[var(--color-border-subtle)] pt-4">
            Paste a <span className="font-medium text-[var(--color-fg-muted)]">personal access token</span>, then{" "}
            <span className="font-medium text-[var(--color-fg-muted)]">Fork … & connect</span>. Owner / Repo / Branch fill
            in automatically. Token stays in this browser only (classic <span className="font-mono text-[11px]">repo</span>{" "}
            scope or fine-grained fork + Contents write).
          </p>
          <div>
            <label className="unt-field-label">GitHub PAT</label>
            <input
              type="password"
              autoComplete="off"
              value={githubWorkspace.token}
              onChange={(e) => setGithubWorkspace({ token: e.target.value })}
              placeholder="ghp_… or fine-grained token"
              className="unt-input w-full font-mono text-[13px]"
              aria-label="GitHub personal access token"
            />
          </div>
          <button
            type="button"
            disabled={!githubWorkspace.token.trim() || githubAssistBusy !== null}
            onClick={() => void githubAssistForkConnect()}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-emerald-500/50 bg-emerald-500/[0.10] px-4 py-2.5 text-[13px] font-semibold text-emerald-300 transition-colors hover:border-emerald-500/70 hover:bg-emerald-500/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
            title={`Fork ${upstreamForkTarget.owner}/${upstreamForkTarget.repo} into your account (GitHub API) and wire Owner / Repo / Branch`}
          >
            {githubAssistBusy === "fork" ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Forking…
              </span>
            ) : (
              `Fork ${upstreamForkTarget.owner}/${upstreamForkTarget.repo} & connect`
            )}
          </button>
          <p className="unt-help-text">
            Same as GitHub&apos;s Fork button — fork stays under your account. Self-hosted builds:{" "}
            <span className="font-mono text-[10px]">VITE_GITHUB_UPSTREAM_OWNER</span> /{" "}
            <span className="font-mono text-[10px]">VITE_GITHUB_UPSTREAM_REPO</span>.
          </p>
          {githubAssistErr ? <p className="unt-help-text font-medium text-red-400/90">{githubAssistErr}</p> : null}
          {githubWorkspace.owner.trim() && githubWorkspace.repo.trim() ? (
            <p className="unt-help-text text-emerald-400/80">
              ✓ Connected to {githubWorkspace.owner}/{githubWorkspace.repo}
            </p>
          ) : null}

          {/* Local workspace — instant HMR edits from chat */}
          <div className="border-t border-[var(--color-border-subtle)] pt-4">
            <h3 className="unt-field-label mb-1">Local workspace (instant edits)</h3>
            <p className="unt-help-text mb-3">
              Point chat at your local clone of the repo. File edits from chat are written
              directly to disk — Vite HMR reloads the app instantly, no GitHub commit needed.
              A <span className="font-medium text-[var(--color-fg-muted)]">Push to GitHub</span> button
              appears in the chat footer to sync when you&apos;re ready.
            </p>
            {!isFileSystemAccessSupported() ? (
              <p className="unt-help-text text-amber-400/80">
                Not supported in this browser. Use Chrome or Edge for local workspace access.
              </p>
            ) : localWorkspaceHandle ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,#22d3ee_20%,transparent)] bg-[color-mix(in_srgb,#22d3ee_5%,transparent)] px-3 py-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-cyan-400/70" />
                  <span className="truncate font-mono text-[11px] text-cyan-300/70">
                    {localWorkspaceHandle.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={disconnectLocalWorkspace}
                  className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)] transition-colors hover:border-[rgba(255,255,255,0.2)] hover:text-[var(--color-fg)]"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={localWsBusy}
                onClick={async () => {
                  setLocalWsBusy(true);
                  setLocalWsErr(null);
                  try {
                    await connectLocalWorkspace();
                  } catch (e) {
                    if (!(e instanceof Error && e.name === "AbortError")) {
                      setLocalWsErr(e instanceof Error ? e.message : String(e));
                    }
                  } finally {
                    setLocalWsBusy(false);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-emerald-500/50 bg-emerald-500/[0.10] px-4 py-2.5 text-[13px] font-semibold text-emerald-300 transition-colors hover:border-emerald-500/70 hover:bg-emerald-500/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {localWsBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Opening folder picker…
                  </>
                ) : (
                  "Connect local workspace folder"
                )}
              </button>
            )}
            {localWsErr ? <p className="unt-help-text mt-2 font-medium text-red-400/90">{localWsErr}</p> : null}
          </div>

        </section>
      </div>

      {/* Sticky save footer */}
      <div className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sideBar)] px-4 py-3">
        <button
          type="button"
          onClick={handleSave}
          className={
            "flex w-full items-center justify-center gap-2 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold transition-all duration-150 " +
            (saved
              ? "border-emerald-500/60 bg-emerald-500/[0.14] text-emerald-300"
              : "border-emerald-500/50 bg-emerald-500/[0.10] text-emerald-300 hover:border-emerald-500/70 hover:bg-emerald-500/[0.18]")
          }
        >
          {saved ? (
            <>
              <Check className="size-4" strokeWidth={2.5} />
              Saved
            </>
          ) : (
            "Save settings"
          )}
        </button>
      </div>
    </div>
  );
}
