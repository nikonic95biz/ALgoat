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
