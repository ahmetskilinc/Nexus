/// Policy for the shell tool: the accident-guardrail denylist and the
/// restricted environment allowlist.

/// How much of the runtime's launch environment an agent command receives.
/// "compatible" is the local-development default; "restricted" retains the
/// original passive-secret-leak reduction for users who prefer it.
export type CommandEnvironment = "compatible" | "restricted";

export function commandEnvironmentFromString(
  value: string,
): CommandEnvironment {
  return value === "restricted" ? "restricted" : "compatible";
}

/// Environment variables preserved when spawning a command in restricted
/// mode. Everything else the runtime process inherited is dropped, so
/// credentials or tokens that happen to live in the runtime's environment
/// cannot leak into an agent-run shell. Only non-secret vars that real
/// toolchains (cargo, npm, git) need are kept; `LC_*` is matched by prefix,
/// and `SSH_AUTH_SOCK` is forwarded when present so git over ssh keeps
/// working. Note: this bounds passive env leakage — it does not sandbox the
/// command, which can still reach the filesystem.
export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "TZ",
  "SSH_AUTH_SOCK",
  "TMP",
] as const;

/// Applies the environment allowlist: only the vars in `ENV_ALLOWLIST`
/// (plus any `LC_*`) that are set survive.
export function restrictedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      (ENV_ALLOWLIST as readonly string[]).includes(key) ||
      key.startsWith("LC_")
    ) {
      env[key] = value;
    }
  }
  return env;
}

const DENYLIST: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/,
  /rm\s+-[a-z]*f[a-z]*r?\s+(\/|~|\$HOME)(\s|$)/,
  /\bmkfs\b/,
  /\bdd\b[^\n]*\bof=\/dev\//,
  />\s*\/dev\/sd/,
  /:\(\)\s*\{\s*:\s*\|\s*:/,
];

/// A tiny accident guardrail — NOT a security boundary (trivially bypassed by
/// obfuscation). It refuses a handful of catastrophic patterns before the
/// command ever runs, in both approval modes.
export function isDeniedCommand(command: string): boolean {
  return DENYLIST.some((pattern) => pattern.test(command));
}
