/**
 * Internal ID for the bundled order-book scalper (`reduceScalperPaper` + optional live Lightning).
 * Listed under Built-in in the Dashboard preset picker.
 */
export const BUILTIN_SCALPER_PRESET_ID = "unt-builtin-scalper";

/** Extensible shape if you ship curated presets again later. */
export type BuiltinAlgoPreset = {
  id: string;
  name: string;
  description: string;
  detail: string;
  tags: string[];
};

/** Curated catalog presets (optional); the runnable scalper uses `BUILTIN_SCALPER_PRESET_ID` in the picker. */
export const BUILTIN_ALGO_PRESETS: BuiltinAlgoPreset[] = [];
