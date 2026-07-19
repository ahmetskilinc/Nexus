/// A tool failure addressed to the model, not the user: a plain sentence the
/// agent loop renders into the tool result (usually prefixed "Error: ") so
/// the model can read it and adjust course. Deliberately distinct from
/// RuntimeError — a failed tool call is conversation content and must never
/// abort the run. Keep messages to one human sentence: no JSON, no stack
/// traces.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
