/**
 * Canonical OSS coordinates users fork when they want live editing — override per-build via env.
 * Keeps one-click fork predictable without requiring Owner/Repo typing first.
 */
export function getDefaultGithubUpstream(): { owner: string; repo: string } {
  const o = import.meta.env.VITE_GITHUB_UPSTREAM_OWNER?.trim();
  const r = import.meta.env.VITE_GITHUB_UPSTREAM_REPO?.trim();
  if (o && r) return { owner: o, repo: r };
  // No default — set VITE_GITHUB_UPSTREAM_OWNER and VITE_GITHUB_UPSTREAM_REPO in .env.local
  return { owner: "", repo: "" };
}
