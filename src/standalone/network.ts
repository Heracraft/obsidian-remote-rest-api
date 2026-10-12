/** An optional allowlist of client networks.
 *
 *  By default the server answers every client, like any HTTP API: the API key
 *  is the access control, and anything in front of the server (a firewall, a
 *  reverse proxy, a VPN) decides who can reach it. ALLOWED_CLIENT_NETWORKS
 *  narrows that to a list of networks, checked against the address that
 *  connects. Behind a reverse proxy that address is the proxy's. */

import net from "net";

export interface Cidr {
  family: 4 | 6;
  base: bigint;
  prefix: number;
  text: string;
}

export class NetworkPolicyError extends Error {}

/** Parse "a.b.c.d/n" or "x::y/n"; a bare address is a /32 or /128. */
export function parseCidr(text: string): Cidr {
  const [address, prefixText] = text.trim().split("/");
  const parsed = parseAddress(address);
  if (!parsed) throw new NetworkPolicyError(`'${text}' is not an IP address or network.`);
  const bits = parsed.family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits || !/^\d*$/.test(prefixText ?? "")) {
    throw new NetworkPolicyError(`'${text}' has an invalid prefix length.`);
  }
  const mask = prefixMask(parsed.family, prefix);
  return { family: parsed.family, base: parsed.value & mask, prefix, text: text.trim() };
}

/** An address as a number, with IPv4-mapped IPv6 (`::ffff:10.0.0.1`) read as
 *  the IPv4 address it carries. Null for anything that is not an address. */
export function parseAddress(text: string): { family: 4 | 6; value: bigint } | null {
  let address = text.trim();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) address = mapped[1];
  if (net.isIPv4(address)) {
    const value = address.split(".").reduce((sum, octet) => (sum << 8n) + BigInt(Number(octet)), 0n);
    return { family: 4, value };
  }
  if (!net.isIPv6(address)) return null;
  // A trailing dotted quad ("::ffff:1.2.3.4", "64:ff9b::1.2.3.4") holds the
  // last two groups.
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    address = address.slice(0, quad.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const parts = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const [head, tail] = address.split("::");
  const headGroups = parts(head);
  const tailGroups = tail === undefined ? [] : parts(tail);
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups];
  const value = groups.reduce((sum, group) => (sum << 16n) + BigInt(parseInt(group, 16)), 0n);
  const mappedValue = value >> 32n === 0xffffn ? value & 0xffffffffn : null;
  if (mappedValue !== null) return { family: 4, value: mappedValue };
  return { family: 6, value };
}

function prefixMask(family: 4 | 6, prefix: number): bigint {
  const bits = family === 4 ? 32 : 128;
  const all = (1n << BigInt(bits)) - 1n;
  return prefix === 0 ? 0n : (all >> BigInt(bits - prefix)) << BigInt(bits - prefix);
}

export function contains(network: Cidr, address: { family: 4 | 6; value: bigint }): boolean {
  return network.family === address.family && (address.value & prefixMask(network.family, network.prefix)) === network.base;
}

/** The networks named in ALLOWED_CLIENT_NETWORKS, or null when it is not
 *  set and every client is allowed. */
export function allowedNetworks(configured: string | undefined): Cidr[] | null {
  const text = configured?.trim();
  if (!text) return null;
  return text.split(/[\s,]+/).filter((entry) => entry.length > 0).map(parseCidr);
}

export function isAllowed(address: string | undefined, networks: Cidr[]): boolean {
  if (!address) return false;
  const parsed = parseAddress(address);
  return parsed !== null && networks.some((network) => contains(network, parsed));
}

export interface ClientCheck {
  allowed: boolean;
  /** The address that was refused, when one was. */
  refused?: string;
}

interface RequestLike {
  socket: { remoteAddress?: string };
}

/** Whether a request may be served: always, unless an allowlist is set and
 *  the connecting address is outside it. */
export function checkClient(req: RequestLike, networks: Cidr[] | null): ClientCheck {
  if (networks === null) return { allowed: true };
  const source = req.socket.remoteAddress;
  if (isAllowed(source, networks)) return { allowed: true };
  return { allowed: false, refused: source ?? "unknown" };
}
