import { resolveLlmApiUrl } from "@/lib/llmDevProxy";

function githubHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

/** Encode path segments for `/contents/` URLs */
export function encodeRepoContentPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function githubFetch(token: string, pathnameWithQuery: string, init?: RequestInit): Promise<Response> {
  const url = resolveLlmApiUrl(`https://api.github.com${pathnameWithQuery}`);
  return fetch(url, {
    ...init,
    headers: githubHeaders(token, init?.headers),
  });
}

export async function githubParseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string };
    return j.message ?? res.statusText;
  } catch {
    return await res.text().catch(() => res.statusText);
  }
}

export async function githubVerifyRepo(token: string, owner: string, repo: string): Promise<void> {
  const res = await githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!res.ok) throw new Error(await githubParseError(res));
}

/** Authenticated user login (`octocat`) — validates PAT read scope. */
export async function githubGetViewerLogin(token: string): Promise<string> {
  const res = await githubFetch(token, `/user`);
  if (!res.ok) throw new Error(await githubParseError(res));
  const j = (await res.json()) as { login?: string };
  if (!j.login?.trim()) throw new Error("No GitHub login in token response");
  return j.login.trim();
}

export async function githubGetRepoMeta(
  token: string,
  owner: string,
  repo: string,
): Promise<{ defaultBranch: string } | null> {
  const res = await githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await githubParseError(res));
  const j = (await res.json()) as { default_branch?: string };
  const b = j.default_branch?.trim();
  return { defaultBranch: b || "main" };
}

/**
 * Ensures `upstreamOwner/upstreamRepo` exists under the PAT user's account as `login/upstreamRepo`
 * (GitHub's fork naming convention). Creates fork via API if missing.
 *
 * Classic PAT: needs **`repo`** (private forks) or at least fork-capable scopes on public repos.
 * Fine-grained: repository permissions must include **fork** / administration as GitHub documents for forks.
 */
export async function githubForkUpstreamIntoViewerAccount(opts: {
  token: string;
  upstreamOwner: string;
  upstreamRepo: string;
}): Promise<{ owner: string; repo: string; branch: string }> {
  const { token, upstreamOwner, upstreamRepo } = opts;
  const login = await githubGetViewerLogin(token);

  let meta = await githubGetRepoMeta(token, login, upstreamRepo);
  if (meta) {
    return { owner: login, repo: upstreamRepo, branch: meta.defaultBranch };
  }

  const res = await githubFetch(
    token,
    `/repos/${encodeURIComponent(upstreamOwner)}/${encodeURIComponent(upstreamRepo)}/forks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

  if (res.status === 422) {
    meta = await githubGetRepoMeta(token, login, upstreamRepo);
    if (meta) return { owner: login, repo: upstreamRepo, branch: meta.defaultBranch };
    throw new Error(await githubParseError(res));
  }

  if (!res.ok) throw new Error(await githubParseError(res));

  const deadline = Date.now() + 28_000;
  while (Date.now() < deadline) {
    meta = await githubGetRepoMeta(token, login, upstreamRepo);
    if (meta) return { owner: login, repo: upstreamRepo, branch: meta.defaultBranch };
    await new Promise((r) => window.setTimeout(r, 750));
  }
  throw new Error(
    "Fork is still preparing on GitHub — open github.com and try **Fork & connect** again in a minute.",
  );
}

/** Non-empty paths from recursive git tree (blobs only). */
export async function githubListTextPaths(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string[]> {
  const refRes = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  if (!refRes.ok) throw new Error(await githubParseError(refRes));
  const refJson = (await refRes.json()) as { object?: { sha?: string } };
  const commitSha = refJson.object?.sha;
  if (!commitSha) throw new Error("Could not resolve branch ref");

  const commitRes = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${commitSha}`,
  );
  if (!commitRes.ok) throw new Error(await githubParseError(commitRes));
  const commitJson = (await commitRes.json()) as { tree?: { sha?: string } };
  const treeSha = commitJson.tree?.sha;
  if (!treeSha) throw new Error("Could not read commit tree");

  const treeRes = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${treeSha}?recursive=1`,
  );
  if (!treeRes.ok) throw new Error(await githubParseError(treeRes));
  const treeJson = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };

  const skip = (p: string) =>
    p.startsWith("node_modules/") ||
    p.startsWith("dist/") ||
    p.startsWith(".git/") ||
    /\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(p);

  const out: string[] = [];
  for (const item of treeJson.tree ?? []) {
    if (item.type !== "blob" || !item.path) continue;
    if (skip(item.path)) continue;
    if (item.size != null && item.size > 900_000) continue;
    out.push(item.path);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export async function githubGetFileContent(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): Promise<{ text: string; sha: string }> {
  const enc = encodeRepoContentPath(filePath);
  const res = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${enc}?ref=${encodeURIComponent(branch)}`,
  );
  if (!res.ok) throw new Error(await githubParseError(res));
  const j = (await res.json()) as {
    encoding?: string;
    content?: string;
    sha?: string;
    type?: string;
  };
  if (j.type !== "file" || j.encoding !== "base64" || !j.content || !j.sha) {
    throw new Error("Not a readable text file at this path");
  }
  const bin = Uint8Array.from(atob(j.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bin);
  return { text, sha: j.sha };
}

/** Returns the commit SHA of the newly created commit. */
export async function githubPutFileContent(opts: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  message: string;
  contentUtf8: string;
  /** Omit to create a new file; provide to update an existing file. */
  sha?: string;
}): Promise<{ commitSha: string }> {
  const { token, owner, repo, branch, path, message, contentUtf8, sha } = opts;
  const bytes = new TextEncoder().encode(contentUtf8);
  const content = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  const enc = encodeRepoContentPath(path);
  const body: Record<string, string> = { message, content, branch };
  if (sha) body.sha = sha;

  const res = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${enc}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await githubParseError(res));
  const j = (await res.json()) as { commit?: { sha?: string } };
  return { commitSha: j.commit?.sha ?? "" };
}

/** Trigger a GitHub Actions workflow dispatch (requires `workflow` PAT scope). */
export async function githubTriggerWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowFile: string,
  branch: string,
): Promise<void> {
  const res = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: branch }),
    },
  );
  if (!res.ok) throw new Error(await githubParseError(res));
}

export type WorkflowRunStatus = {
  status: "queued" | "in_progress" | "completed" | null;
  conclusion: "success" | "failure" | "cancelled" | null;
  html_url: string;
};

/** Latest run for a given workflow file (e.g. `deploy-pages.yml`). Returns null if not found. */
export async function githubGetLatestWorkflowRun(
  token: string,
  owner: string,
  repo: string,
  workflowFile: string,
): Promise<WorkflowRunStatus | null> {
  const res = await githubFetch(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=1`,
  );
  if (!res.ok) return null;
  const j = (await res.json()) as {
    workflow_runs?: Array<{
      status?: string;
      conclusion?: string | null;
      html_url?: string;
    }>;
  };
  const run = j.workflow_runs?.[0];
  if (!run) return null;
  return {
    status: (run.status as WorkflowRunStatus["status"]) ?? null,
    conclusion: (run.conclusion as WorkflowRunStatus["conclusion"]) ?? null,
    html_url: run.html_url ?? "",
  };
}
