import { useEffect, useMemo, useState } from "react";
import { InlineToolbarPicker } from "@/components/InlineToolbarPicker";
import { Tooltip } from "@/components/Tooltip";
import { useApp } from "@/context/AppContext";
import { BUILTIN_SCALPER_PRESET_ID } from "@/lib/algorithmPresets";
import { SCALPER_PAPER_CONFIG } from "@/lib/scalperPaperConfig";
import type { UserAlgoPreset } from "@/types";

function compactList(items: string[]): string {
  return items.length ? items.join(" · ") : "Not set";
}

function formatKnobValue(value: number | string | boolean): string {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Not set";
  return value?.trim() ? value : "Not set";
}

type ScalperConfig = NonNullable<UserAlgoPreset["config"]>;

function toScalperConfig(config?: UserAlgoPreset["config"]): ScalperConfig {
  return {
    dipMinPct: config?.dipMinPct ?? SCALPER_PAPER_CONFIG.dipMinPct,
    catalystMinSol: config?.catalystMinSol ?? SCALPER_PAPER_CONFIG.catalystMinSol,
    takeProfitPct: config?.takeProfitPct ?? SCALPER_PAPER_CONFIG.takeProfitPct,
    minOrderBookSellSolForStop:
      config?.minOrderBookSellSolForStop ?? SCALPER_PAPER_CONFIG.minOrderBookSellSolForStop,
    realSlippagePct: config?.realSlippagePct ?? SCALPER_PAPER_CONFIG.realSlippagePct,
    realPriorityFeeSol: config?.realPriorityFeeSol ?? SCALPER_PAPER_CONFIG.realPriorityFeeSol,
    reentryCooldownMs: config?.reentryCooldownMs ?? SCALPER_PAPER_CONFIG.reentryCooldownMs,
  };
}

function KnobField({
  id,
  label,
  tip,
  children,
}: {
  id: string;
  label: string;
  tip: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Tooltip text={tip} side="top">
        <label className="unt-field-label cursor-default" htmlFor={id}>{label}</label>
      </Tooltip>
      {children}
    </div>
  );
}

export function TrainingDataPanel() {
  const {
    userAlgos,
    algoBlueprints,
    scalperUserConfig,
    setScalperUserConfig,
    saveUserAlgoPreset,
    removeUserAlgo,
    saveAlgoBlueprint,
    focusedAlgoLabPresetId,
    setFocusedAlgoLabPresetId,
  } = useApp();
  const [workOnId, setWorkOnId] = useState(BUILTIN_SCALPER_PRESET_ID);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const presetGroups = useMemo(() => {
    const builtin = {
      heading: "Built-in",
      items: [{ value: BUILTIN_SCALPER_PRESET_ID, label: "Order-book scalper" }],
    };
    if (userAlgos.length === 0) return [builtin];
    return [
      builtin,
      { heading: "Your algos", items: userAlgos.map((a) => ({ value: a.id, label: a.name })) },
    ];
  }, [userAlgos]);

  const selectedUserPreset = userAlgos.find((a) => a.id === workOnId);
  const selectedBlueprint = algoBlueprints.find((b) => b.implementation.presetId === workOnId);
  const sourceConfig = selectedUserPreset?.config ?? scalperUserConfig;
  const isScalperPreset =
    workOnId === BUILTIN_SCALPER_PRESET_ID ||
    selectedUserPreset?.strategyId === BUILTIN_SCALPER_PRESET_ID;
  const [draftConfig, setDraftConfig] = useState<ScalperConfig>(toScalperConfig(sourceConfig));

  useEffect(() => {
    setDraftConfig(toScalperConfig(sourceConfig));
  }, [sourceConfig, workOnId]);

  useEffect(() => {
    if (!focusedAlgoLabPresetId) return;
    setWorkOnId(focusedAlgoLabPresetId);
    setFocusedAlgoLabPresetId(null);
  }, [focusedAlgoLabPresetId, setFocusedAlgoLabPresetId]);

  const createPreset = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const presetId = saveUserAlgoPreset({
      name: trimmed,
      description: "Chat to create this algo.",
      source: "manual",
    });
    setWorkOnId(presetId);
    setName("");
    setCreating(false);
  };

  const deletePreset = (id: string) => {
    removeUserAlgo(id);
    if (workOnId === id) setWorkOnId(BUILTIN_SCALPER_PRESET_ID);
  };

  const setConfigValue = (key: keyof ScalperConfig, value: number) => {
    if (!Number.isFinite(value)) return;
    setDraftConfig((prev) => ({ ...prev, [key]: value }));
  };

  const savePresetConfig = () => {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
    if (workOnId === BUILTIN_SCALPER_PRESET_ID) {
      setScalperUserConfig(draftConfig);
    } else if (selectedUserPreset) {
      saveUserAlgoPreset({
        ...selectedUserPreset,
        id: selectedUserPreset.id,
        createdAt: selectedUserPreset.createdAt,
        config: draftConfig,
      });
    }

    if (selectedBlueprint) {
      saveAlgoBlueprint({
        ...selectedBlueprint,
        id: selectedBlueprint.id,
        createdAt: selectedBlueprint.createdAt,
        updatedAt: Date.now(),
        knobs: selectedBlueprint.knobs.map((knob) => {
          if (knob.key === "dipMinPct") return { ...knob, value: draftConfig.dipMinPct };
          if (knob.key === "catalystMinSol") return { ...knob, value: draftConfig.catalystMinSol };
          if (knob.key === "takeProfitPct") return { ...knob, value: draftConfig.takeProfitPct };
          if (knob.key === "minOrderBookSellSolForStop") {
            return { ...knob, value: draftConfig.minOrderBookSellSolForStop };
          }
          if (knob.key === "realSlippagePct") return { ...knob, value: draftConfig.realSlippagePct };
          if (knob.key === "realPriorityFeeSol") {
            return { ...knob, value: draftConfig.realPriorityFeeSol };
          }
          if (knob.key === "reentryCooldownMs") {
            return { ...knob, value: draftConfig.reentryCooldownMs };
          }
          return knob;
        }),
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Create / select preset */}
      <section className="unt-section-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="unt-section-title">Create your algo</h2>
            <Tooltip text="Name a new preset here. Build the strategy logic through the LLM chat, then trade it from the Trading tab." side="right">
              <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="rounded-md border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-400/15"
          >
            Create new
          </button>
        </div>

        <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div>
            <label className="unt-field-label" htmlFor="algo-lab-workon-trigger">Work on</label>
            <InlineToolbarPicker
              id="algo-lab-workon"
              value={workOnId}
              onChange={(v) => setWorkOnId(v || BUILTIN_SCALPER_PRESET_ID)}
              groups={presetGroups}
              renderItemAction={(item, close) => (
                item.value === BUILTIN_SCALPER_PRESET_ID ? null : (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete ${item.label}`}
                    title={`Delete ${item.label}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deletePreset(item.value);
                      close();
                    }}
                    className="shrink-0 rounded border border-red-500/35 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/15"
                  >
                    Delete
                  </span>
                )
              )}
              aria-label="Work on algo"
            />
          </div>

          {creating ? (
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.025)] p-3">
              <label className="unt-field-label" htmlFor="algo-lab-preset-name">Preset name</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="algo-lab-preset-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Zombie algo"
                  className="unt-input h-9 min-w-0 flex-1 text-[13px]"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") createPreset(); }}
                />
                <button
                  type="button"
                  onClick={createPreset}
                  disabled={!name.trim()}
                  className="unt-btn-primary px-3 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Blueprint details */}
      {selectedBlueprint ? (
        <section className="unt-section-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="unt-section-title truncate">{selectedBlueprint.name}</h3>
              <div className="mt-1 unt-section-overline">{selectedBlueprint.status}</div>
            </div>
          </div>
          <div className="grid gap-2 border-t border-[var(--color-border-subtle)] pt-3 text-[12px]">
            <div><span className="text-[var(--color-fg-dim)]">Goal:</span> <span className="text-[var(--color-fg)]">{selectedBlueprint.goal}</span></div>
            <div><span className="text-[var(--color-fg-dim)]">Market:</span> <span className="text-[var(--color-fg)]">{compactList(selectedBlueprint.universe)}</span></div>
            <div><span className="text-[var(--color-fg-dim)]">Signals:</span> <span className="text-[var(--color-fg)]">{compactList(selectedBlueprint.signals)}</span></div>
            <div><span className="text-[var(--color-fg-dim)]">Entry:</span> <span className="text-[var(--color-fg)]">{compactList(selectedBlueprint.entryRules)}</span></div>
            <div><span className="text-[var(--color-fg-dim)]">Exit:</span> <span className="text-[var(--color-fg)]">{compactList(selectedBlueprint.exitRules)}</span></div>
            <div><span className="text-[var(--color-fg-dim)]">Risk:</span> <span className="text-[var(--color-fg)]">{compactList(selectedBlueprint.riskRules)}</span></div>
            <div className="border-t border-[var(--color-border-subtle)] pt-2">
              <span className="text-[var(--color-fg-dim)]">Knobs:</span>
              {selectedBlueprint.knobs.length > 0 ? (
                <div className="mt-1.5 grid gap-1.5">
                  {selectedBlueprint.knobs.map((knob) => (
                    <div key={knob.key} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.02)] px-2 py-1.5">
                      <span className="text-[var(--color-fg-muted)]">{knob.label}</span>
                      <span className="font-mono text-[var(--color-fg)]">
                        {formatKnobValue(knob.value)}{knob.unit ? ` ${knob.unit}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1.5 rounded-md border border-dashed border-[var(--color-border-subtle)] px-2.5 py-2 text-[11px] text-[var(--color-fg-dim)]">
                  No knobs selected yet — create your knobs in chat.
                </div>
              )}
            </div>
          </div>
        </section>
      ) : workOnId !== BUILTIN_SCALPER_PRESET_ID ? (
        <section className="unt-section-card">
          <p className="unt-help-text">Chat to create this algo.</p>
        </section>
      ) : null}

      {/* Scalper knobs */}
      {isScalperPreset ? (
        <section className="unt-section-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="unt-section-title">Order-book scalper</h3>
              <Tooltip text="These knobs control the live scalper. Save preset to apply them to the next trading session." side="right">
                <span className="grid size-4 cursor-help place-items-center rounded-full border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-fg-dim)]">?</span>
              </Tooltip>
            </div>
            <button
              type="button"
              onClick={savePresetConfig}
              className={
                "px-3 py-1.5 text-[11px] font-semibold rounded-md border transition-all " +
                (savedFlash
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "unt-btn-primary")
              }
            >
              {savedFlash ? "✓ Saved" : "Save preset"}
            </button>
          </div>

          <div className="grid gap-3 border-t border-[var(--color-border-subtle)] pt-3 sm:grid-cols-2">
            <KnobField id="lab-dip-pct" label="Entry dip %" tip="How far price must drop from the recent high before the algo arms and watches for a catalyst buy.">
              <input
                id="lab-dip-pct"
                type="number"
                min={1}
                max={50}
                step={1}
                value={draftConfig.dipMinPct}
                onChange={(e) => setConfigValue("dipMinPct", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-catalyst-sol" label="Entry min buy (SOL)" tip="Minimum SOL size of a single buy order on the tape that counts as an entry catalyst.">
              <input
                id="lab-catalyst-sol"
                type="number"
                min={0.01}
                max={10}
                step={0.05}
                value={draftConfig.catalystMinSol}
                onChange={(e) => setConfigValue("catalystMinSol", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-tp-pct" label="Exit take profit %" tip="Percentage gain from entry price that triggers an automatic sell.">
              <input
                id="lab-tp-pct"
                type="number"
                min={1}
                max={200}
                step={1}
                value={draftConfig.takeProfitPct}
                onChange={(e) => setConfigValue("takeProfitPct", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-stop-sol" label="Exit stop sell (SOL)" tip="If someone sells at least this much SOL in a single order, the algo exits immediately as a stop.">
              <input
                id="lab-stop-sol"
                type="number"
                min={0.01}
                max={10}
                step={0.05}
                value={draftConfig.minOrderBookSellSolForStop}
                onChange={(e) => setConfigValue("minOrderBookSellSolForStop", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-cooldown-s" label="Re-entry cooldown (s)" tip="Seconds the algo waits after closing a trade before it can enter again.">
              <input
                id="lab-cooldown-s"
                type="number"
                min={2}
                max={300}
                step={1}
                value={Math.round(draftConfig.reentryCooldownMs / 1000)}
                onChange={(e) =>
                  setConfigValue("reentryCooldownMs", Math.round(Number(e.target.value)) * 1000)
                }
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-slippage-pct" label="Real slippage %" tip="Maximum acceptable slippage for real on-chain buys and sells via PumpPortal Lightning.">
              <input
                id="lab-slippage-pct"
                type="number"
                min={1}
                max={50}
                step={1}
                value={draftConfig.realSlippagePct}
                onChange={(e) => setConfigValue("realSlippagePct", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px]"
              />
            </KnobField>

            <KnobField id="lab-priority-sol" label="Real priority fee (SOL)" tip="Solana priority fee per transaction in real trading mode. Higher = faster confirmation.">
              <input
                id="lab-priority-sol"
                type="number"
                min={0.00001}
                max={0.1}
                step={0.0005}
                value={draftConfig.realPriorityFeeSol}
                onChange={(e) => setConfigValue("realPriorityFeeSol", Number(e.target.value))}
                className="unt-input h-9 w-full font-mono text-[13px] sm:col-span-2"
              />
            </KnobField>
          </div>
        </section>
      ) : null}
    </div>
  );
}
