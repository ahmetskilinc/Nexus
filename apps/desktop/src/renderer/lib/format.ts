export const createId = () => crypto.randomUUID();

export function shortModel(model?: string) {
  if (!model) return undefined;
  if (model.startsWith("claude-"))
    return model.replace(/^claude-/, "").replace(/-\d{6,}$/, "");
  return model;
}

export function basename(value: string) {
  return value.split(/[\\/]/).pop() ?? value;
}

export function parentDir(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.length ? `~/${parts.slice(-2).join("/")}` : value;
}

/// Compact token-count label, e.g. 1000000 → "1M", 200000 → "200K".
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/// Estimated-cost label: "$1.24"; sub-cent amounts round rather than showing
/// "$0.00" ("<$0.01" for anything positive but tiny).
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.005) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

export function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
