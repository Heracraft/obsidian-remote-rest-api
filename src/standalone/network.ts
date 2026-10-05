/** Who may reach the server, by network address.
 *
 *  This server hands out full read and write access to a folder of notes on
 *  one bearer token. It is meant for a private network: a Tailscale tailnet, a
 *  WireGuard tunnel, the Docker network a reverse proxy shares with it. It is
 *  not meant to face the internet, and there is no setting that lets it:
 *
 *  - it will not bind to a public address, nor to a wildcard address while
 *    the machine it runs on has a public one;
 *  - it answers no request whose source address is public;
 *  - it answers no proxied request whose `X-Forwarded-For`, `X-Real-IP` or
 *    `Forwarded` header names a public client.
 *
 *  "Private" means the ranges below. Tailscale hands out 100.64.0.0/10 and
 *  fd7a:115c:a1e0::/48; WireGuard tunnels conventionally use RFC 1918 or ULA
 *  space; Docker's own networks are RFC 1918. The operator may narrow the list
 *  with ALLOWED_CLIENT_NETWORKS, never widen it past these. */

import net from "net";
import os from "os";

export interface Cidr {
  family: 4 | 6;
  base: bigint;
  prefix: number;
  text: string;
}

export const PRIVATE_NETWORKS: readonly string[] = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // RFC 1918
  "172.16.0.0/12", // RFC 1918, Docker's default bridge networks
  "192.168.0.0/16", // RFC 1918
  "100.64.0.0/10", // carrier-grade NAT space, Tailscale
  "169.254.0.0/16", // link-local
  "::1/128", // loopback
  "fc00::/7", // unique local, Tailscale's fd7a:115c:a1e0::/48 among them
  "fe80::/10", // link-local
];

const DEFAULT_NETWORKS = PRIVATE_NETWORKS.map(parseCidr);

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

/** Whether every address in `inner` is in `outer`. */
function within(inner: Cidr, outer: Cidr): boolean {
  return inner.family === outer.family && inner.prefix >= outer.prefix && contains(outer, { family: inner.family, value: inner.base });
}

/** The networks clients may come from: the private ranges, or the narrower
 *  list in ALLOWED_CLIENT_NETWORKS. A configured network that reaches outside
 *  the private ranges is refused, not trimmed: a typo that opened the server
 *  to the internet must stop it from starting. */
export function allowedNetworks(configured: string | undefined): Cidr[] {
  const text = configured?.trim();
  if (!text) return DEFAULT_NETWORKS;
  const networks = text.split(/[\s,]+/).filter((entry) => entry.length > 0).map(parseCidr);
  for (const network of networks) {
    if (!DEFAULT_NETWORKS.some((outer) => within(network, outer))) {
      throw new NetworkPolicyError(
        `ALLOWED_CLIENT_NETWORKS may only name private networks (Tailscale, WireGuard, LAN, Docker), and ${network.text} is not inside any of ${PRIVATE_NETWORKS.join(", ")}.`,
      );
    }
  }
  return networks;
}

export function isAllowed(address: string | undefined, networks: Cidr[]): boolean {
  if (!address) return false;
  const parsed = parseAddress(address);
  return parsed !== null && networks.some((network) => contains(network, parsed));
}

/** Refuse a binding that would put the server on a public address.
 *
 *  A specific address must be in the allowed networks. A wildcard binds every
 *  address the machine has, so it is refused when any of them is public. In a
 *  container on a Docker bridge network the container sees only its private
 *  bridge address, so the wildcard is fine there. On the host's own network
 *  (`network_mode: host`, or no container at all) a machine with a public
 *  address must bind its Tailscale or WireGuard address instead. */
export function assertBindingIsPrivate(
  bindingHost: string,
  networks: Cidr[],
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): void {
  if (bindingHost === "0.0.0.0" || bindingHost === "::") {
    const exposed: string[] = [];
    for (const [name, infos] of Object.entries(interfaces)) {
      for (const info of infos ?? []) {
        // "0.0.0.0" listens on IPv4 only; "::" on both families.
        if (bindingHost === "0.0.0.0" && info.family !== "IPv4") continue;
        if (!isAllowed(info.address, networks)) exposed.push(`${info.address} (${name})`);
      }
    }
    if (exposed.length > 0) {
      throw new NetworkPolicyError(
        `BINDING_HOST=${bindingHost} would listen on ${exposed.join(", ")}, which ${exposed.length === 1 ? "is" : "are"} not in the allowed private networks. ` +
          "This server must not be reachable from the internet. Set BINDING_HOST to this machine's Tailscale or WireGuard address, " +
          "or run it in a container on a Docker bridge network (the default) and publish its port only on such an address.",
      );
    }
    return;
  }
  if (!parseAddress(bindingHost)) {
    throw new NetworkPolicyError(
      `BINDING_HOST must be an IP address (or 0.0.0.0 / ::), not '${bindingHost}', so it can be checked against the allowed private networks.`,
    );
  }
  if (!isAllowed(bindingHost, networks)) {
    throw new NetworkPolicyError(
      `BINDING_HOST=${bindingHost} is not in the allowed private networks. This server must not listen on a public address. ` +
        "Use a Tailscale (100.64.0.0/10) or WireGuard address.",
    );
  }
}

export interface ClientCheck {
  allowed: boolean;
  /** The address that was refused, when one was. */
  refused?: string;
  reason?: "source" | "forwarded";
}

interface RequestLike {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

/** Whether a request may be served: its source address must be in the
 *  allowed networks, and so must every client a proxy says it is forwarding
 *  for. An entry a proxy wrote that is not an address ("unknown", an
 *  obfuscated name) counts as public. */
export function checkClient(req: RequestLike, networks: Cidr[]): ClientCheck {
  const source = req.socket.remoteAddress;
  if (!isAllowed(source, networks)) return { allowed: false, refused: source ?? "unknown", reason: "source" };
  for (const client of forwardedClients(req.headers)) {
    if (!isAllowed(client, networks)) return { allowed: false, refused: client, reason: "forwarded" };
  }
  return { allowed: true };
}

function forwardedClients(headers: RequestLike["headers"]): string[] {
  const values = (name: string): string[] => {
    const value = headers[name];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };
  const clients: string[] = [];
  for (const value of [...values("x-forwarded-for"), ...values("x-real-ip")]) {
    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) clients.push(stripPort(trimmed));
    }
  }
  for (const value of values("forwarded")) {
    for (const match of value.matchAll(/for=("?)([^;,"]+)\1/gi)) clients.push(stripPort(match[2]));
  }
  return clients;
}

function stripPort(entry: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  if (bracketed) return bracketed[1];
  const v4WithPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(entry);
  return v4WithPort ? v4WithPort[1] : entry;
}
