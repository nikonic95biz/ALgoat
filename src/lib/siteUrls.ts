/** Vite `base` — trailing slash or `/`. */
export function viteBaseUrl(): string {
  const b = import.meta.env.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

/** Path to the full trading workspace SPA route (respects `VITE_BASE_PATH`). */
export function workspacePath(): string {
  const base = viteBaseUrl();
  if (base === "/") return "/app";
  return `${base.replace(/\/+$/, "")}/app`;
}

export function isWorkspacePath(pathname: string): boolean {
  const w = workspacePath();
  return pathname === w || pathname.startsWith(`${w}/`);
}

/** Marketing root (same origin + base). */
export function homePath(): string {
  const base = viteBaseUrl();
  return base === "/" ? "/" : base.replace(/\/+$/, "") + "/";
}

/** Public release notes / changelog route (same origin + base). */
export function changelogPath(): string {
  const base = viteBaseUrl();
  if (base === "/") return "/changelog";
  return `${base.replace(/\/+$/, "")}/changelog`;
}

export function isChangelogPath(pathname: string): boolean {
  const p = changelogPath();
  return pathname === p || pathname === `${p}/`;
}
