import { z } from "zod";
import type { ApprovalRequest } from "./approvals";
import type { TodoItem } from "./messages";

/// Every streaming event the runtime emits during a run. This union — together
/// with `runtimeEventSchema` below — is the runtime→app contract.
export type RuntimeEvent =
  | { type: "assistant_text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      summary: string;
      arguments: string;
    }
  | { type: "tool_result"; id: string; name: string; preview: string }
  // One streamed line of a running command's combined output.
  | {
      type: "command_output";
      callId: string;
      stream: "stdout" | "stderr";
      chunk: string;
    }
  // A finished command's terminal status (exitCode null = killed/timed out).
  | {
      type: "command_end";
      callId: string;
      exitCode: number | null;
      timedOut: boolean;
    }
  | ({ type: "approval_request" } & ApprovalRequest)
  // A feature plan published by the write_plan tool (Plan mode).
  | { type: "plan"; title: string; markdown: string }
  // A read-only codebase report published by write_research.
  | { type: "research"; title: string; markdown: string }
  // The agent's latest task list (todo_write); drives the plan panel checklist.
  | { type: "todos"; todos: TodoItem[] }
  // Older turns were summarized to fit the context window; the transcript
  // shows a marker with how many messages were folded away.
  | {
      type: "compacted";
      removedMessages: number;
      keptMessages: number;
      summary: string;
    }
  // A read-only sub-agent (spawn_agent) ran a tool; `callId` ties it to the
  // parent spawn_agent tool item so its card can show live progress.
  | { type: "subagent_step"; callId: string; tool: string; summary: string }
  // OAuth flows: the browser URL to open. Kimi's device flow also carries the
  // user code shown on the verification page.
  | { type: "authorize_url"; url: string; userCode?: string };

/// Tolerance mirrors the retired hand-rolled parser: unknown todo statuses fall
/// back to "pending" and malformed items are dropped (not the whole event).
const todoItemSchema = z
  .object({
    content: z.string(),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .catch("pending" as const),
  })
  .or(z.unknown().transform(() => null));

const approvalRequestVariants = {
  edit: z.object({
    type: z.literal("approval_request"),
    kind: z.literal("edit"),
    callId: z.string(),
    tool: z.string(),
    path: z.string(),
    before: z.string(),
    after: z.preprocess((value) => value ?? null, z.string().nullable()),
  }),
  command: z.object({
    type: z.literal("approval_request"),
    kind: z.literal("command"),
    callId: z.string(),
    tool: z.string(),
    command: z.string(),
  }),
  mcp: z.object({
    type: z.literal("approval_request"),
    kind: z.literal("mcp"),
    callId: z.string(),
    tool: z.string(),
    arguments: z.string(),
  }),
};

export const runtimeEventSchema: z.ZodType<
  RuntimeEvent,
  z.ZodTypeDef,
  unknown
> = z.union([
  z.object({ type: z.literal("assistant_text"), text: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    arguments: z.string().catch(""),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string().catch(""),
    name: z.string(),
    preview: z.string(),
  }),
  z.object({
    type: z.literal("command_output"),
    callId: z.string(),
    stream: z.enum(["stdout", "stderr"]).catch("stdout" as const),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal("command_end"),
    callId: z.string(),
    exitCode: z.number().nullable().catch(null),
    timedOut: z.boolean().catch(false),
  }),
  approvalRequestVariants.edit,
  approvalRequestVariants.command,
  approvalRequestVariants.mcp,
  z.object({
    type: z.literal("plan"),
    title: z.string(),
    markdown: z.string(),
  }),
  z.object({
    type: z.literal("research"),
    title: z.string(),
    markdown: z.string(),
  }),
  z.object({
    type: z.literal("todos"),
    todos: z
      .array(todoItemSchema)
      .transform((items) =>
        items.filter((item): item is TodoItem => item !== null),
      ),
  }),
  z.object({
    type: z.literal("compacted"),
    removedMessages: z.number(),
    keptMessages: z.number(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("subagent_step"),
    callId: z.string(),
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal("authorize_url"),
    url: z.string(),
    userCode: z.string().optional(),
  }),
]);

/// Validates an untrusted value from the runtime boundary into a typed event.
/// Returns undefined for unknown or malformed events — the same "ignore
/// garbage" posture as the old NDJSON parser.
export function parseRuntimeEvent(value: unknown): RuntimeEvent | undefined {
  const parsed = runtimeEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
