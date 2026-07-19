import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let cachedEnvironment: Record<string, string> | undefined;

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/// GUI-launched desktop apps often inherit a minimal PATH that omits Homebrew,
/// language version managers, and user SDKs. Ask the user's login shell for its
/// environment once, then merge it over Electron's inherited environment. A
/// failure is non-fatal: callers still receive the inherited values.
export function loginShellEnvironment(): Record<string, string> {
  if (cachedEnvironment) return { ...cachedEnvironment };
  const inherited = inheritedEnvironment();
  if (process.platform === "win32") {
    cachedEnvironment = inherited;
    return { ...cachedEnvironment };
  }

  const shell = process.env.SHELL || "/bin/sh";
  try {
    const output = execFileSync(shell, ["-ilc", "env -0"], {
      encoding: "buffer",
      env: inherited,
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved: Record<string, string> = {};
    for (const item of output.toString("utf8").split("\0")) {
      const separator = item.indexOf("=");
      if (separator < 1) continue;
      const key = item.slice(0, separator);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      resolved[key] = item.slice(separator + 1);
    }
    cachedEnvironment = { ...inherited, ...resolved };
    logEnvironmentDiagnostics(shell, "interactive login shell", inherited, {
      ...inherited,
      ...resolved,
    });
  } catch (error) {
    console.warn(
      `Could not resolve the login-shell environment from ${shell}:`,
      error instanceof Error ? error.message : error,
    );
    cachedEnvironment = inherited;
    logEnvironmentDiagnostics(
      shell,
      "inherited (resolution failed)",
      inherited,
      inherited,
    );
  }
  return { ...cachedEnvironment };
}

/// One-time startup diagnostics for command/terminal compatibility issues.
/// Deliberately restricted to the shell, launch mode, PATH entries, and
/// variable NAMES — never values, which may hold secrets.
function logEnvironmentDiagnostics(
  shell: string,
  mode: string,
  inherited: Record<string, string>,
  effective: Record<string, string>,
) {
  const pathEntries = (effective.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  console.info(
    [
      `Shell environment: ${shell} (${mode}).`,
      `PATH entries: ${pathEntries.join(", ") || "(empty)"}.`,
      `Inherited variable names: ${Object.keys(inherited).sort().join(", ")}.`,
      `Resolved variable names: ${Object.keys(effective).sort().join(", ")}.`,
    ].join("\n"),
  );
}

/// Resolves the interactive terminal's shell: the user's configured absolute
/// path when it exists, otherwise the platform default. A configured value
/// that fails validation is loudly ignored rather than breaking the terminal.
export function resolveShell(preferred?: string): string {
  const candidate = preferred?.trim();
  if (candidate) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate;
    console.warn(
      `Configured terminal shell "${candidate}" is not an absolute path to an existing file; using the platform default instead.`,
    );
  }
  return defaultShell();
}

export function defaultShell(): string {
  if (process.platform === "win32")
    return process.env.COMSPEC ?? "powershell.exe";
  return process.env.SHELL ?? "/bin/bash";
}

/// Start common Unix shells as login shells so their normal profile files load
/// inside the interactive PTY. Windows shells use their native startup rules.
export function defaultShellArgs(shell: string): string[] {
  if (process.platform === "win32") {
    return path.basename(shell).toLowerCase().startsWith("powershell")
      ? ["-NoLogo"]
      : [];
  }
  const name = path.basename(shell);
  return ["sh", "bash", "zsh", "ksh", "fish"].includes(name) ? ["-l"] : [];
}
