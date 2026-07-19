import type { RuntimeEmitter, TodoItem } from "@nexus/protocol";
import { asArray, asRecord, asString } from "@nexus/protocol";
import { listMemories, saveMemory } from "@nexus/workspace";

function parseArgs(argumentsJson: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(argumentsJson)) ?? {};
  } catch {
    return {};
  }
}

/// Records the model's task list: emits a `todos` event so the UI can render
/// a live checklist, and returns a compact text rendering for the model's own
/// record. The full list replaces the previous one on every call.
export function todoTool(
  emitter: RuntimeEmitter,
  _callId: string,
  argumentsJson: string,
): string {
  const items = asArray(parseArgs(argumentsJson).todos);
  if (!items) return 'Error: "todos" must be an array.';
  const todos: TodoItem[] = [];
  for (const item of items) {
    const content = asString(asRecord(item)?.content);
    if (content === undefined) continue;
    const raw = asString(asRecord(item)?.status) ?? "pending";
    const status =
      raw === "pending" || raw === "in_progress" || raw === "completed"
        ? raw
        : "pending";
    todos.push({ content, status });
  }

  emitter.emit({ type: "todos", todos });

  if (todos.length === 0) return "The task list is empty.";
  const lines = todos.map((todo) => {
    const mark =
      todo.status === "completed"
        ? "[x]"
        : todo.status === "in_progress"
          ? "[~]"
          : "[ ]";
    return `${mark} ${todo.content}`;
  });
  return `Task list updated:\n${lines.join("\n")}`;
}

/// Publishes the feature plan: emits a `plan` event so the desktop can render
/// the plan document in its side panel, and returns a short confirmation for
/// the model's own record. A later call replaces the previous plan.
export function planTool(
  emitter: RuntimeEmitter,
  _callId: string,
  argumentsJson: string,
): string {
  const parsed = parseArgs(argumentsJson);
  const title = (asString(parsed.title) ?? "").trim();
  const markdown = (asString(parsed.markdown) ?? "").trim();
  if (markdown.length === 0)
    return 'Error: "markdown" is required and must be a non-empty plan document.';

  emitter.emit({ type: "plan", title, markdown });

  return "Plan published to the user. Now call todo_write to lay out the checklist, then carry it out.";
}

export function researchTool(
  emitter: RuntimeEmitter,
  _callId: string,
  argumentsJson: string,
): string {
  const parsed = parseArgs(argumentsJson);
  const title = (asString(parsed.title) ?? "").trim();
  const markdown = (asString(parsed.markdown) ?? "").trim();
  if (markdown.length === 0)
    return 'Error: "markdown" is required and must be a non-empty research report.';

  emitter.emit({ type: "research", title, markdown });

  return "Research report published to the user. Stop now without planning or implementing changes.";
}

/// Handles the per-workspace memory tools. `memory_save` stores a fact;
/// `memory_list` returns the current facts.
export async function memoryTool(
  workspace: string,
  name: string,
  argumentsJson: string,
): Promise<string> {
  if (name === "memory_save") {
    const fact = asString(parseArgs(argumentsJson).fact);
    if (fact === undefined)
      return 'Error: memory_save requires a "fact" string.';
    try {
      const memory = await saveMemory(workspace, fact);
      return `Saved to memory: ${memory.fact}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  // memory_list
  const memories = await listMemories(workspace);
  if (memories.length === 0) return "No memories saved for this workspace yet.";
  const lines = memories.map((memory) => `- ${memory.fact}`);
  return `Saved memories for this workspace:\n${lines.join("\n")}`;
}
