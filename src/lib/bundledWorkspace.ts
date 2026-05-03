/** Browser-local edits on top of the build-time bundled snapshot (no GitHub required). */
const OVERLAY_KEY = "unt_workspace_bundled_overlay_v1";

export type BundledWorkspaceManifest = {
  paths: string[];
  generatedAt?: string;
};

export function bundledWorkspaceAssetUrl(relativePathNoLeadingSlash: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const encoded = relativePathNoLeadingSlash
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${base}bundled-workspace/root/${encoded}`;
}

export async function fetchBundledWorkspaceManifest(): Promise<BundledWorkspaceManifest | null> {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const url = `${base}bundled-workspace/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  try {
    return (await res.json()) as BundledWorkspaceManifest;
  } catch {
    return null;
  }
}

export async function fetchBundledFileText(repoRelativePath: string): Promise<string> {
  const url = bundledWorkspaceAssetUrl(repoRelativePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${repoRelativePath} (${res.status})`);
  return await res.text();
}

function readOverlay(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as Record<string, string>;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function writeOverlay(next: Record<string, string>) {
  localStorage.setItem(OVERLAY_KEY, JSON.stringify(next));
}

export function getBundledOverlay(path: string): string | undefined {
  return readOverlay()[path];
}

export function setBundledOverlay(path: string, content: string) {
  const cur = readOverlay();
  cur[path] = content;
  writeOverlay(cur);
}

export function clearBundledOverlay(path: string) {
  const cur = readOverlay();
  delete cur[path];
  writeOverlay(cur);
}
