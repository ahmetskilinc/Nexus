import type { TodoItem, TranscriptItem } from "@nexus/protocol";
import {
  CheckIcon,
  CompassIcon,
  DeleteIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  type IconComponent,
  PlusIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  WriteFileIcon,
} from "../components/Icons";

/// The single place tool names are interpreted for rendering. Components ask
/// `describeToolCall` what a call is and how to show it; adding a runtime tool
/// means one entry here, not edits across four render files.

/// Which card renders the call: the streaming terminal card, the live task
/// list, or the generic collapsible tool card.
export type ToolCardKind = "command" | "todo" | "subagent" | "generic";

/// A parsed, human-readable summary of a single tool call. `target` is rendered
/// in monospace (a path, a search pattern); `meta` is a subtle trailing detail.
export type ToolPresentation = {
  card: ToolCardKind;
  Icon: IconComponent;
  verb: string;
  target?: string;
  meta?: string;
  /// Content results (file contents, search hits) collapse behind a chevron.
  /// Status results (an "Edited …" line) render inline and never expand.
  bodyKind: "content" | "status";
};

/// Tolerant parse of a tool call's raw JSON arguments — malformed or missing
/// args become an empty object, never a throw at render time.
export function parseJsonArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/// The validated todo list from a todo_write call's arguments.
export function parseTodos(raw?: string): TodoItem[] {
  const todos = parseJsonArgs(raw).todos;
  if (!Array.isArray(todos)) return [];
  return todos.filter(
    (todo): todo is TodoItem =>
      Boolean(todo) &&
      typeof (todo as TodoItem).content === "string" &&
      ["pending", "in_progress", "completed"].includes(
        (todo as TodoItem).status,
      ),
  );
}

/// The shell command from a run_command call's arguments.
export function commandFromArgs(raw?: string): string {
  const command = parseJsonArgs(raw).command;
  return typeof command === "string" ? command : "";
}

/// The program name an allowlist entry keys on — the first whitespace-delimited
/// token of a command (e.g. "npm" from "npm run build").
export function commandProgram(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

const APPROVAL_LABELS: Record<string, string> = {
  create_file: "Create",
  write_file: "Write",
  edit_file: "Edit",
  multi_edit: "Edit",
  delete_file: "Delete",
  rename_file: "Rename",
  run_command: "Run",
};

/// Short imperative label for an approval card's header.
export function approvalToolLabel(tool: string): string {
  return APPROVAL_LABELS[tool] ?? tool;
}

/// Whether a tool's `result` is owned by its own streamed output
/// (command_output events) and must not be clobbered by the shorter
/// tool_result preview.
export function toolOwnsStreamedResult(name: string): boolean {
  return name === "run_command";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function describeToolCall(item: TranscriptItem): ToolPresentation {
  const name = item.title;
  const a = parseJsonArgs(item.args);
  const path = str(a.path);

  switch (name) {
    case "run_command":
      return {
        card: "command",
        Icon: TerminalIcon,
        verb: "Run",
        target: commandFromArgs(item.args),
        bodyKind: "content",
      };
    case "todo_write":
      return {
        card: "todo",
        Icon: CheckIcon,
        verb: "Task list",
        bodyKind: "status",
      };
    case "spawn_agent":
      return {
        card: "subagent",
        Icon: CompassIcon,
        verb: "Research",
        target: str(a.task),
        bodyKind: "content",
      };
    case "read_file": {
      const start = num(a.start_line);
      const end = num(a.end_line);
      const range =
        start && end
          ? `L${start}–${end}`
          : start
            ? `from L${start}`
            : end
              ? `to L${end}`
              : undefined;
      return {
        card: "generic",
        Icon: FileIcon,
        verb: "Read",
        target: path,
        meta: range,
        bodyKind: "content",
      };
    }
    case "write_file":
      return {
        card: "generic",
        Icon: WriteFileIcon,
        verb: "Write",
        target: path,
        bodyKind: "status",
      };
    case "edit_file":
      return {
        card: "generic",
        Icon: WriteFileIcon,
        verb: "Edit",
        target: path,
        meta: a.replace_all ? "all" : undefined,
        bodyKind: "status",
      };
    case "create_file":
      return {
        card: "generic",
        Icon: PlusIcon,
        verb: "Create",
        target: path,
        bodyKind: "status",
      };
    case "delete_file":
      return {
        card: "generic",
        Icon: DeleteIcon,
        verb: "Delete",
        target: path,
        bodyKind: "status",
      };
    case "list_directory":
      return {
        card: "generic",
        Icon: FolderIcon,
        verb: "List",
        target: path || "/",
        bodyKind: "content",
      };
    case "grep":
      return {
        card: "generic",
        Icon: SearchIcon,
        verb: "Search",
        target: str(a.pattern),
        meta: path ? `in ${path}` : undefined,
        bodyKind: "content",
      };
    case "glob":
      return {
        card: "generic",
        Icon: FolderIcon,
        verb: "Find files",
        target: str(a.pattern),
        meta: str(a.path) ? `in ${str(a.path)}` : undefined,
        bodyKind: "content",
      };
    case "git_status":
      return {
        card: "generic",
        Icon: GitBranchIcon,
        verb: "Git status",
        bodyKind: "content",
      };
    case "git_diff":
      return {
        card: "generic",
        Icon: GitBranchIcon,
        verb: "Git diff",
        target: path,
        meta: a.staged ? "staged" : undefined,
        bodyKind: "content",
      };
    case "multi_edit": {
      const edits = Array.isArray(a.edits) ? a.edits.length : undefined;
      return {
        card: "generic",
        Icon: WriteFileIcon,
        verb: "Edit",
        target: path,
        meta: edits ? `${edits} edits` : undefined,
        bodyKind: "status",
      };
    }
    case "rename_file":
      return {
        card: "generic",
        Icon: FileIcon,
        verb: "Rename",
        target: str(a.from),
        meta: str(a.to) ? `→ ${str(a.to)}` : undefined,
        bodyKind: "status",
      };
    case "web_fetch":
      return {
        card: "generic",
        Icon: GlobeIcon,
        verb: "Fetch",
        target: str(a.url),
        bodyKind: "content",
      };
    case "web_search":
      return {
        card: "generic",
        Icon: GlobeIcon,
        verb: "Search web",
        target: str(a.query),
        bodyKind: "content",
      };
    default:
      if (name.startsWith("mcp__")) {
        // mcp__<server>__<tool> → "tool · via server"
        const [, server, ...rest] = name.split("__");
        return {
          card: "generic",
          Icon: WrenchIcon,
          verb: rest.join("_") || name,
          meta: server ? `via ${server}` : undefined,
          bodyKind: "content",
        };
      }
      return {
        card: "generic",
        Icon: WrenchIcon,
        verb: name.replace(/_/g, " "),
        meta: item.detail || undefined,
        bodyKind: "content",
      };
  }
}
