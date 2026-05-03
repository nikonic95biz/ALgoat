import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePumpPortalConfigRevision } from "@/hooks/usePumpPortalConfigRevision";
import { useApp } from "@/context/AppContext";
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
import { githubForkUpstreamIntoViewerAccount, githubGetViewerLogin } from "@/lib/githubApi";
import { getDefaultGithubUpstream } from "@/lib/githubUpstreamDefaults";
import { computeSetupSteps } from "@/lib/setupProgress";

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
  const { model, setModel, githubWorkspace, setGithubWorkspace } = useApp();

  const [draftPumpKey, setDraftPumpKey] = useState(getStoredPumpPortalApiKey);
  const [draftTradingWalletSecret, setDraftTradingWalletSecret] = useState(getStoredPumpPortalTradingWalletSecret);
  const [draftLlmKey, setDraftLlmKey] = useState(model.apiKey);
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const upstreamForkTarget = useMemo(() => getDefaultGithubUpstream(), []);
  const [githubAssistBusy, setGithubAssistBusy] = useState<null | "login" | "fork">(null);
  const [githubAssistErr, setGithubAssistErr] = useState<string | null>(null);

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

  async function githubAssistDetectLogin() {
    const t = githubWorkspace.token.trim();
    if (!t) {
      setGithubAssistErr("Paste a PAT first.");
      return;
    }
    setGithubAssistErr(null);
    setGithubAssistBusy("login");
    try {
      const login = await githubGetViewerLogin(t);
      setGithubWorkspace({ owner: login });
    } catch (e) {
      setGithubAssistErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGithubAssistBusy(null);
    }
  }

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
            PumpPortal gives you a wallet for trades — docs suggest keeping around{" "}
            <span className="text-[var(--color-fg)]">~0.02 SOL</span> there for full streams; empty tape can still be API key,
            mint, or message-shape issues (not only balance). Your key is saved in this browser as you type.{" "}
            <a
              href={PORTAL_SETUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-keyword)] underline-offset-2 hover:underline"
            >
              top up on PumpPortal ↗
            </a>
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
              Stored only in this browser. We derive your public address for{" "}
              <span className="text-[var(--color-fg-muted)]">getBalance</span> via your RPC (
              <code className="font-mono text-[10px]">VITE_SOLANA_RPC_URL</code> or mainnet default). PumpPortal Lightning
              trades still execute from the wallet linked to your API key on PumpPortal — use the same keypair there.
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
            className="unt-btn-primary w-full px-4 py-2.5 text-[13px] font-medium disabled:opacity-50"
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
          {githubWorkspace.owner.trim() &&
          githubWorkspace.repo.trim() &&
          githubWorkspace.branch.trim() ? (
            <p className="unt-callout font-mono text-[12px]">
              Code sidebar →{" "}
              <span className="text-[var(--color-keyword)]">
                {githubWorkspace.owner}/{githubWorkspace.repo}
              </span>{" "}
              @ <span className="text-[var(--color-fg)]">{githubWorkspace.branch}</span>
            </p>
          ) : null}
          {githubAssistErr ? <p className="unt-help-text font-medium text-red-400/90">{githubAssistErr}</p> : null}

          <details className="rounded-lg border border-[var(--color-border-subtle)] [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-semibold text-[var(--color-fg-heading)] hover:text-[var(--color-fg)]">
              Manual overrides (different fork name / branch)
            </summary>
            <div className="space-y-3 border-t border-[var(--color-border-subtle)] px-3 pb-3 pt-3">
              <button
                type="button"
                disabled={!githubWorkspace.token.trim() || githubAssistBusy !== null}
                onClick={() => void githubAssistDetectLogin()}
                className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-fill)] px-4 py-2 text-[13px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-fill-hover)] disabled:opacity-50"
              >
                {githubAssistBusy === "login" ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Checking token…
                  </span>
                ) : (
                  "Fill Owner only from token"
                )}
              </button>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="unt-field-label">Owner</label>
                  <input
                    value={githubWorkspace.owner}
                    onChange={(e) => setGithubWorkspace({ owner: e.target.value })}
                    placeholder="your-github-login"
                    className="unt-input w-full font-mono text-[13px]"
                    aria-label="GitHub repository owner"
                  />
                </div>
                <div>
                  <label className="unt-field-label">Repo</label>
                  <input
                    value={githubWorkspace.repo}
                    onChange={(e) => setGithubWorkspace({ repo: e.target.value })}
                    placeholder={upstreamForkTarget.repo}
                    className="unt-input w-full font-mono text-[13px]"
                    aria-label="GitHub repository name"
                  />
                </div>
              </div>
              <div>
                <label className="unt-field-label">Branch</label>
                <input
                  value={githubWorkspace.branch}
                  onChange={(e) => setGithubWorkspace({ branch: e.target.value })}
                  placeholder="main"
                  className="unt-input w-full font-mono text-[13px]"
                  aria-label="Git branch"
                />
              </div>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
