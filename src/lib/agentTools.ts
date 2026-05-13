/**
 * Agentic tool definitions and executor for the in-app Claude chat.
 * These tools let Claude read and write files autonomously — no Apply buttons,
 * no "load the file first" dance.
 */

import { readLocalFile, writeLocalFile, listLocalFiles } from "@/lib/localWorkspace";

// ─── Anthropic tool schema ────────────────────────────────────────────────────

// NOTE: Anthropic converts tool definitions to internal XML and counts them toward
// input tokens (~200–500 tokens per tool). Keep descriptions concise to stay under
// the 30k TPM limit across multi-round tool sessions.
export const AGENT_TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the local project workspace. Use before editing a file you haven't seen.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path, e.g. src/components/AlgoTabs.tsx" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file. Always write the COMPLETE file — never partial diffs. Vite HMR reloads it instantly.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path, e.g. src/components/AlgoTabs.tsx" },
        content: { type: "string", description: "Full file content." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List TS/TSX source files. Use to discover structure when unsure which file to edit.",
    input_schema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Path prefix filter, e.g. src/components/" },
      },
    },
  },
  {
    name: "search_code",
    description: "Search source code for text. Use to locate components, hooks, or labels before editing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search, e.g. AlgoTabs or useApp" },
        prefix: { type: "string", description: "Path prefix, default src/" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_typecheck",
    description: "Run TypeScript typecheck. Call after meaningful edits; fix errors before claiming done.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_build",
    description: "Run production build. Use for larger changes when typecheck is insufficient.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_dom_snapshot",
    description: "Get text snapshot of the live browser app. Use after UI edits to verify changes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "assert_text_visible",
    description: "Assert text is visible in the live app after changing labels, buttons, or headings.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text that should be visible." },
      },
      required: ["text"],
    },
  },
  {
    name: "get_console_errors",
    description: "Read browser console errors from the running app. Use after edits to catch HMR issues.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_edit_history",
    description: "Show recent file edit IDs available to roll back.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "rollback_edit",
    description: "Roll back a write_file edit. Omit editId to roll back the most recent edit.",
    input_schema: {
      type: "object",
      properties: {
        editId: { type: "string", description: "Edit ID from write_file, or omit for latest." },
      },
    },
  },
] as const;

export const BROWSER_WORKSPACE_TOOLS = AGENT_TOOLS.filter((tool) =>
  tool.name === "read_file" || tool.name === "write_file" || tool.name === "list_files"
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolName =
  | "read_file"
  | "write_file"
  | "list_files"
  | "search_code"
  | "run_typecheck"
  | "run_build"
  | "get_dom_snapshot"
  | "assert_text_visible"
  | "get_console_errors"
  | "get_edit_history"
  | "rollback_edit";

export type ToolCall = {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
};

export type ToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

// ─── Executor ─────────────────────────────────────────────────────────────────

async function callLocalAgent(tool: ToolName, input: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/__agent/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if (data.content != null) return String(data.content);
    if (Array.isArray(data.files)) return data.files.join("\n");
    if (Array.isArray(data.results)) {
      return data.results.map((r) => {
        const row = r as { path?: string; line?: number; text?: string };
        return `${row.path}:${row.line}: ${row.text}`;
      }).join("\n") || "(no matches)";
    }
    if (data.output != null) return String(data.output);
    if (data.error != null) return `ERROR: ${String(data.error)}`;
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

export async function executeTool(
  call: ToolCall,
  workspaceHandle?: FileSystemDirectoryHandle | null,
): Promise<string> {
  const localAgentResult = await callLocalAgent(call.name, call.input);
  if (localAgentResult !== null) return localAgentResult;

  if (!workspaceHandle) {
    return "ERROR: local IDE agent is unavailable and no browser workspace handle is connected.";
  }

  switch (call.name) {
    case "read_file": {
      const path = String(call.input.path ?? "").replace(/^\//, "");
      if (!path) return "ERROR: path is required. Example: src/components/AlgoTabs.tsx";
      try {
        const content = await readLocalFile(workspaceHandle, path);
        return content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `ERROR reading ${path}: ${msg}\n\nThe file may not exist. Use list_files or search_code to find the right path.`;
      }
    }

    case "write_file": {
      const path = String(call.input.path ?? "").replace(/^\//, "");
      const content = String(call.input.content ?? "");
      if (!path) return "ERROR: path is required";
      if (!content) return "ERROR: content is required";
      try {
        await writeLocalFile(workspaceHandle, path, content);
        const written = await readLocalFile(workspaceHandle, path);
        if (written !== content) {
          return `ERROR writing ${path}: read-back verification failed. The file on disk does not match the content just written.`;
        }
        return `OK — wrote and verified ${path} (${content.length} chars). Vite HMR should reload instantly.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `ERROR writing ${path}: ${msg}`;
      }
    }

    case "list_files": {
      const prefix = String(call.input.prefix ?? "");
      try {
        const all = await listLocalFiles(workspaceHandle, 400);
        const filtered = prefix
          ? all.filter((p) => p.startsWith(prefix))
          : all.filter((p) => p.startsWith("src/") && /\.(ts|tsx)$/.test(p));
        const result = filtered.slice(0, 200).join("\n");
        return result || `No .ts/.tsx files found${prefix ? ` under ${prefix}` : " in src/"}. The workspace has ${all.length} total files.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `ERROR listing files: ${msg}\n\nTry search_code or read_file with a specific known path instead.`;
      }
    }

    case "search_code":
      return "ERROR: search_code requires the local IDE agent server.";

    case "run_typecheck":
      return "ERROR: run_typecheck requires the local IDE agent server.";

    case "run_build":
      return "ERROR: run_build requires the local IDE agent server.";

    case "get_dom_snapshot":
      return "ERROR: get_dom_snapshot requires the local IDE agent server.";

    case "assert_text_visible":
      return "ERROR: assert_text_visible requires the local IDE agent server.";

    case "get_console_errors":
      return "ERROR: get_console_errors requires the local IDE agent server.";

    case "get_edit_history":
      return "ERROR: get_edit_history requires the local IDE agent server.";

    case "rollback_edit":
      return "ERROR: rollback_edit requires the local IDE agent server.";

    default:
      return `ERROR: unknown tool "${call.name}"`;
  }
}

/** Human-readable label for a tool call, shown in the chat bubble. */
export function toolCallLabel(call: ToolCall): string {
  switch (call.name) {
    case "read_file":
      return `Reading \`${call.input.path}\`…`;
    case "write_file":
      return `Writing \`${call.input.path}\`…`;
    case "list_files":
      return `Listing files${call.input.prefix ? ` in \`${call.input.prefix}\`` : ""}…`;
    case "search_code":
      return `Searching for \`${call.input.query}\`…`;
    case "run_typecheck":
      return "Running TypeScript check…";
    case "run_build":
      return "Running production build…";
    case "get_dom_snapshot":
      return "Inspecting running app…";
    case "assert_text_visible":
      return `Verifying \`${call.input.text}\` is visible…`;
    case "get_console_errors":
      return "Checking browser console…";
    case "get_edit_history":
      return "Reading edit history…";
    case "rollback_edit":
      return call.input.editId ? `Rolling back \`${call.input.editId}\`…` : "Rolling back latest edit…";
    default:
      return `Calling \`${call.name}\`…`;
  }
}
