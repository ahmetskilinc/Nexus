/// SSRF guard for the agent web tools: only globally-routable addresses may
/// be fetched. Ported range-for-range from the Rust runtime's `is_public`.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { errorMessage } from "./util";

function parseIpv4(address: string): number[] {
  return address.split(".").map((octet) => Number.parseInt(octet, 10));
}

/// Expands an IPv6 literal into its eight 16-bit segments. Assumes the
/// address already passed `isIP(...) === 6`.
function parseIpv6(address: string): number[] {
  let text = address;
  // Zone index (fe80::1%en0) — strip it.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // Trailing dotted-quad (::ffff:127.0.0.1) becomes two segments.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".", lastColon)) {
    const quad = parseIpv4(text.slice(lastColon + 1));
    tail = [(quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]];
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }
  const [head, rest] = text.split("::");
  const headParts =
    head === "" ? [] : head.split(":").map((s) => Number.parseInt(s, 16));
  const restParts =
    rest === undefined || rest === ""
      ? []
      : rest.split(":").map((s) => Number.parseInt(s, 16));
  if (rest === undefined) {
    return [...headParts, ...tail];
  }
  const filler = 8 - headParts.length - restParts.length - tail.length;
  return [
    ...headParts,
    ...Array.from({ length: filler }, () => 0),
    ...restParts,
    ...tail,
  ];
}

function isPublicV4(octets: number[]): boolean {
  const [a, b] = octets;
  const isLoopback = a === 127;
  const isPrivate =
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  const isLinkLocal = a === 169 && b === 254;
  const isBroadcast = octets.every((octet) => octet === 255);
  const isDocumentation =
    (a === 192 && b === 0 && octets[2] === 2) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113);
  const isUnspecified = octets.every((octet) => octet === 0);
  const isMulticast = a >= 224 && a <= 239;
  const isZeroNet = a === 0; // 0.0.0.0/8
  const isCgnat = a === 100 && (b & 0xc0) === 64; // 100.64.0.0/10
  return !(
    isLoopback ||
    isPrivate ||
    isLinkLocal ||
    isBroadcast ||
    isDocumentation ||
    isUnspecified ||
    isMulticast ||
    isZeroNet ||
    isCgnat
  );
}

/// Returns true only for globally-routable addresses. Blocks SSRF to
/// loopback, link-local (incl. the 169.254.169.254 cloud-metadata endpoint),
/// private, CGNAT, unique-local, multicast, and unspecified ranges.
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(parseIpv4(address));
  if (version !== 6) return false;
  const segments = parseIpv6(address);
  // v4-mapped (::ffff:0:0/96): classify the embedded IPv4 address.
  if (
    segments.slice(0, 5).every((segment) => segment === 0) &&
    segments[5] === 0xffff
  ) {
    return isPublicV4([
      segments[6] >> 8,
      segments[6] & 0xff,
      segments[7] >> 8,
      segments[7] & 0xff,
    ]);
  }
  const first = segments[0];
  const isLoopback =
    segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
  const isUnspecified = segments.every((segment) => segment === 0);
  const isMulticast = (first & 0xff00) === 0xff00;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00; // fc00::/7
  const isLinkLocal = (first & 0xffc0) === 0xfe80; // fe80::/10
  return !(
    isLoopback ||
    isUnspecified ||
    isMulticast ||
    isUniqueLocal ||
    isLinkLocal
  );
}

export type LookupFn = (host: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = (host) => lookup(host, { all: true });

/// Rejects a URL whose host resolves to any non-public address before it is
/// fetched. Note: this is a pre-connection check, so a DNS name that rebinds
/// between here and the actual connection is a residual (narrow) risk.
/// Throws a plain Error carrying the sentence; callers wrap it.
export async function guardPublicUrl(
  url: string,
  lookupFn: LookupFn = defaultLookup,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("the URL could not be parsed");
  }
  let host = parsed.hostname;
  if (host === "") throw new Error("the URL has no host");
  // Node's URL keeps IPv6 literals bracketed; getaddrinfo wants them bare.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  let resolved: { address: string }[];
  try {
    resolved = await lookupFn(host);
  } catch (error) {
    throw new Error(`the host could not be resolved: ${errorMessage(error)}`);
  }
  if (resolved.length === 0) {
    throw new Error("the host did not resolve to any address");
  }
  for (const { address } of resolved) {
    if (!isPublicAddress(address)) {
      throw new Error(`refusing to fetch a non-public address (${address})`);
    }
  }
}
