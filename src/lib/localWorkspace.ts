/**
 * Local Workspace — File System Access API wrapper
 *
 * Allows the in-app chat to write files directly to the user's local repo clone.
 * When the user runs `npm run dev`, Vite HMR picks up writes immediately — no
 * GitHub commit or redeploy needed.
 *
 * Persistence: the directory handle is stored in IndexedDB so the connection
 * survives page reloads. The browser still requires one permission click per
 * session (requestPermission), but the user doesn't have to re-pick the folder.
 *
 * Compatibility: Chrome/Edge 86+, Safari 15.2+. Firefox does not support
 * showDirectoryPicker — callers should check isFileSystemAccessSupported().
 */

const IDB_NAME = "unt_local_workspace_v1";
const IDB_STORE = "handles";
const IDB_KEY = "root";

// ─── Feature detection ────────────────────────────────────────────────────────

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearPersistedHandle(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore — handle simply won't be there next load
  }
}

// ─── Permission ───────────────────────────────────────────────────────────────

type PermissionableHandle = FileSystemDirectoryHandle & {
  queryPermission: (opts: { mode: string }) => Promise<string>;
  requestPermission: (opts: { mode: string }) => Promise<string>;
};

/**
 * Checks (and if needed requests) readwrite permission for a persisted handle.
 * Returns true if permission is now granted, false otherwise.
 */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissionableHandle;
  const perm = await h.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  const req = await h.requestPermission({ mode: "readwrite" });
  return req === "granted";
}

// ─── Open picker ─────────────────────────────────────────────────────────────

/**
 * Opens a directory picker, persists the handle, and returns it.
 * Throws if the user cancels or permission is denied.
 */
export async function openLocalWorkspace(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("File System Access API is not supported in this browser. Use Chrome or Edge.");
  }
  // `showDirectoryPicker` is not in TypeScript's built-in lib yet for all targets
  const handle = await (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker({ mode: "readwrite" });
  await persistHandle(handle);
  return handle;
}

// ─── File writer ──────────────────────────────────────────────────────────────

/**
 * Write `content` to `path` (relative to `dirHandle`), creating
 * intermediate directories as needed.
 *
 * Example: writeLocalFile(handle, "src/lib/foo.ts", "export const x = 1;")
 */
export async function writeLocalFile(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const parts = path.replace(/^\//, "").split("/");
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid path: ${path}`);

  // Walk / create directory tree
  let current: FileSystemDirectoryHandle = dirHandle;
  for (const segment of parts) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// ─── File reader / lister ─────────────────────────────────────────────────────

/**
 * Read the contents of a file inside the local workspace.
 * Throws if the file doesn't exist or permission is denied.
 */
export async function readLocalFile(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<string> {
  const parts = path.replace(/^\//, "").split("/");
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid path: ${path}`);

  let current: FileSystemDirectoryHandle = dirHandle;
  for (const segment of parts) {
    current = await current.getDirectoryHandle(segment, { create: false });
  }
  const fileHandle = await current.getFileHandle(fileName, { create: false });
  const file = await fileHandle.getFile();
  return await file.text();
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".vite", "coverage",
  "build", ".next", ".turbo", ".cache", "bundled-workspace",
]);
const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".eot", ".zip", ".lock",
  ".mp4", ".mov", ".webm",
]);

/**
 * Walk the local workspace and return relative file paths.
 * Skips heavy/binary directories and files.
 */
export async function listLocalFiles(
  dirHandle: FileSystemDirectoryHandle,
  maxFiles = 500,
): Promise<string[]> {
  const out: string[] = [];

  type DirHandleWithValues = FileSystemDirectoryHandle & {
    values(): AsyncIterableIterator<FileSystemHandle>;
  };

  async function walk(handle: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    if (out.length >= maxFiles) return;
    const iter = (handle as DirHandleWithValues).values();
    for await (const entry of iter) {
      if (out.length >= maxFiles) return;
      if (entry.kind === "directory") {
        if (SKIP_DIRS.has(entry.name)) continue;
        const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        await walk(entry as FileSystemDirectoryHandle, childPath);
      } else if (entry.kind === "file") {
        const dotIdx = entry.name.lastIndexOf(".");
        const ext = dotIdx !== -1 ? entry.name.slice(dotIdx).toLowerCase() : "";
        if (SKIP_EXTS.has(ext)) continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        out.push(relPath);
      }
    }
  }

  // Let errors propagate so callers know something went wrong (permission, etc.)
  await walk(dirHandle, "");
  return out.sort();
}

/**
 * Build an exports digest from the local workspace — { path: [exportNames] }.
 * Used to ground the chat LLM so it can't hallucinate hooks/types/components.
 * Cached for 15 s so we don't re-walk on every chat send.
 */
let _digestCache: { handle: FileSystemDirectoryHandle; digest: Record<string, string[]>; at: number } | null = null;
const DIGEST_TTL_MS = 15_000;

export async function buildLocalExportsDigest(
  dirHandle: FileSystemDirectoryHandle,
): Promise<Record<string, string[]>> {
  const now = Date.now();
  if (_digestCache && _digestCache.handle === dirHandle && now - _digestCache.at < DIGEST_TTL_MS) {
    return _digestCache.digest;
  }

  const paths = (await listLocalFiles(dirHandle, 800)).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts"),
  );
  const digest: Record<string, string[]> = {};
  for (const rel of paths) {
    try {
      const src = await readLocalFile(dirHandle, rel);
      const names = extractExportNames(src);
      if (names.length > 0) digest[rel] = names;
    } catch {
      /* skip unreadable file */
    }
  }
  _digestCache = { handle: dirHandle, digest, at: Date.now() };
  return digest;
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>();
  const reDecl = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = reDecl.exec(source)) !== null) names.add(m[1]!);
  const reList = /^\s*export\s*\{([^}]+)\}/gm;
  while ((m = reList.exec(source)) !== null) {
    for (const part of m[1]!.split(",")) {
      const trimmed = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (trimmed && /^[A-Za-z_$][\w$]*$/.test(trimmed)) names.add(trimmed);
    }
  }
  return [...names].sort();
}
