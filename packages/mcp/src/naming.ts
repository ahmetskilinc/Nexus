/// Builds the exposed tool name, sanitising anything the providers reject in a
/// function name (they allow `[a-zA-Z0-9_-]`), and bounding the length.
export function namespacedToolName(server: string, tool: string): string {
  const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
  const name = `mcp__${sanitize(server)}__${sanitize(tool)}`;
  return name.slice(0, 64);
}
