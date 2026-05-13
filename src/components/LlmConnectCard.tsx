/**
 * Shared LLM connection card — used in:
 *  - Chat empty-state lock screen (large)
 *  - Chat footer popover (compact)
 *
 * Flow: paste API key → auto-detect provider → pick model → save.
 */
import { useState, useEffect } from "react";
import {
  type LlmBackendId,
  LLM_BACKENDS,
  getLlmBackend,
  inferBackendIdFromBaseUrl,
  inferLlmBackendIdFromApiKey,
} from "@/lib/llmBackends";
import { fetchOpenAiCompatibleModelList } from "@/lib/fetchLlmModels";
import { isLikelyLocalLlm } from "@/lib/llmPresets";
import type { ModelSettings } from "@/types";

type Patch = Partial<Pick<ModelSettings, "apiKey" | "baseUrl" | "model" | "llmBackendId" | "providerLabel">>;

export function LlmConnectCard({
  model,
  onSave,
  onCancel,
}: {
  model: ModelSettings;
  onSave: (patch: Patch) => void;
  onCancel?: () => void;
}) {
  const initialBackendId = (): LlmBackendId => {
    const id = model.llmBackendId as LlmBackendId | undefined;
    if (id && LLM_BACKENDS.some((b) => b.id === id)) return id;
    return inferBackendIdFromBaseUrl(model.baseUrl) ?? "anthropic";
  };

  const [backendId, setBackendId] = useState<LlmBackendId>(initialBackendId);
  const [apiKey, setApiKey] = useState(model.apiKey ?? "");
  const [selectedModel, setSelectedModel] = useState(model.model ?? "");
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const backend = getLlmBackend(backendId);
  const isLocal = isLikelyLocalLlm(backend.baseUrl);

  // Auto-detect provider from key as user types
  useEffect(() => {
    if (!apiKey.trim()) { setDetecting(false); return; }
    setDetecting(true);
    const t = setTimeout(() => {
      setDetecting(false);
      const inferred = inferLlmBackendIdFromApiKey(apiKey);
      if (!inferred || inferred === backendId) return;
      setBackendId(inferred);
      setSelectedModel(getLlmBackend(inferred).defaultModel);
    }, 350);
    return () => clearTimeout(t);
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch remote model list when key + provider supports it
  useEffect(() => {
    let alive = true;
    if (!backend.fetchModelsList || (!apiKey.trim() && !isLocal)) {
      setRemoteModels(null); setModelsLoading(false); return;
    }
    setModelsLoading(true);
    void fetchOpenAiCompatibleModelList(backend.baseUrl, apiKey, backend.staticModels).then((ids) => {
      if (!alive) return;
      setRemoteModels(ids);
      setModelsLoading(false);
    });
    return () => { alive = false; };
  }, [backend.baseUrl, backend.fetchModelsList, backend.staticModels, apiKey, isLocal]);

  // When backend changes, reset model to its default
  useEffect(() => {
    setSelectedModel(getLlmBackend(backendId).defaultModel);
    setRemoteModels(null);
  }, [backendId]);

  const models = remoteModels?.length ? remoteModels : backend.staticModels;
  const canSave = isLocal || apiKey.trim().length > 0;

  function handleSave() {
    const b = getLlmBackend(backendId);
    onSave({
      llmBackendId: backendId,
      providerLabel: b.providerLabel,
      baseUrl: b.baseUrl,
      model: selectedModel || b.defaultModel,
      apiKey: isLocal ? "" : apiKey.trim(),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Step 1 — API key */}
      {!isLocal && (
        <div className="space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-fg-dim)]">
            API key
          </label>
          <input
            autoFocus
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) handleSave();
              if (e.key === "Escape") onCancel?.();
            }}
            placeholder="Paste key — provider detected automatically"
            className="w-full rounded-lg border border-cyan-400/18 bg-[rgba(34,211,238,0.04)] px-3 py-2 font-mono text-[11px] text-cyan-100/80 outline-none placeholder:text-[var(--color-fg-dim)] focus:border-cyan-400/35 transition-colors"
          />
          {/* Provider detected inline — no button grid */}
          <div className="flex items-center gap-1.5 min-h-[16px]">
            {apiKey.trim() ? (
              detecting ? (
                <span className="text-[10px] text-[var(--color-fg-dim)]">Detecting…</span>
              ) : (
                <>
                  <span className="size-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                  <span className="text-[10px] text-[var(--color-fg-muted)]">
                    {backend.providerLabel}
                  </span>
                  {/* Manual override — small text link, not a button grid */}
                  <span className="text-[10px] text-[var(--color-fg-dim)]">·</span>
                  <details className="inline">
                    <summary className="cursor-pointer list-none text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg-muted)]">
                      change
                    </summary>
                    <div className="absolute z-10 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sideBar)] py-1 shadow-xl min-w-[140px]">
                      {LLM_BACKENDS.filter((b) => !isLikelyLocalLlm(b.baseUrl)).map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBackendId(b.id)}
                          className={
                            "block w-full px-3 py-1.5 text-left text-[11px] hover:bg-[rgba(255,255,255,0.06)] " +
                            (backendId === b.id ? "text-[var(--color-fg)]" : "text-[var(--color-fg-muted)]")
                          }
                        >
                          {b.providerLabel}
                        </button>
                      ))}
                    </div>
                  </details>
                </>
              )
            ) : (
              <span className="text-[10px] text-[var(--color-fg-dim)]">
                Paste your API key above — we detect the provider
              </span>
            )}
          </div>
        </div>
      )}

      {/* Ollama — no key needed */}
      {isLocal && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/6 px-3 py-2 text-[11px] text-emerald-300/80">
          Ollama running locally — no API key needed.
          <button
            type="button"
            onClick={() => setBackendId("openai")}
            className="ml-2 underline opacity-60 hover:opacity-100"
          >
            Switch to cloud
          </button>
        </div>
      )}

      {/* Step 2 — Model selector */}
      {(isLocal || apiKey.trim()) && (
        <div className="space-y-1.5">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-fg-dim)]">
            Model
            {modelsLoading && <span className="ml-1 font-normal normal-case opacity-50">(loading…)</span>}
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-fill)] px-3 py-2 text-[11px] text-[var(--color-fg)] outline-none focus:border-cyan-400/35"
          >
            {models.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--color-border-subtle)] py-2 text-[12px] text-[var(--color-fg-dim)] transition-colors hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="flex-1 rounded-lg border border-cyan-400/28 bg-cyan-500/12 py-2 text-[12px] font-semibold text-cyan-200 transition-all hover:bg-cyan-500/20 disabled:opacity-35"
        >
          Save &amp; start chatting
        </button>
      </div>
    </div>
  );
}
