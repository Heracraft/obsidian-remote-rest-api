import type os from "os";
import {
  allowedNetworks,
  assertBindingIsPrivate,
  checkClient,
  isAllowed,
  NetworkPolicyError,
  parseAddress,
} from "./network";

const defaults = allowedNetworks(undefined);

function iface(address: string, family: "IPv4" | "IPv6"): os.NetworkInterfaceInfo {
  return { address, family, netmask: "", mac: "", internal: false, cidr: null } as os.NetworkInterfaceInfo;
}

describe("parseAddress", () => {
  test.each([
    ["10.1.2.3", 4, 0x0a010203n],
    ["::ffff:10.1.2.3", 4, 0x0a010203n],
    ["[::1]", 6, 1n],
    ["fe80::1%eth0", 6, 0xfe800000000000000000000000000001n],
    ["fd7a:115c:a1e0::1", 6, 0xfd7a115ca1e000000000000000000001n],
    ["64:ff9b::1.2.3.4", 6, 0x0064ff9b000000000000000001020304n],
  ])("%s", (text, family, value) => {
    expect(parseAddress(text)).toEqual({ family, value });
  });

  test.each(["unknown", "", "1.2.3", "example.com", "_hidden"])("refuses %j", (text) => {
    expect(parseAddress(text)).toBeNull();
  });
});

describe("the default allowed networks", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.17.0.1",
    "192.168.1.10",
    "100.101.102.103",
    "::1",
    "fd7a:115c:a1e0::abcd",
    "::ffff:192.168.1.10",
  ])("allow %s", (address) => {
    expect(isAllowed(address, defaults)).toBe(true);
  });

  test.each(["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860:4860::8888", "::ffff:1.1.1.1", undefined])(
    "refuse %s",
    (address) => {
      expect(isAllowed(address, defaults)).toBe(false);
    },
  );
});

describe("ALLOWED_CLIENT_NETWORKS", () => {
  test("narrows the list", () => {
    const tailnetOnly = allowedNetworks("100.64.0.0/10, fd7a:115c:a1e0::/48");
    expect(isAllowed("100.70.1.1", tailnetOnly)).toBe(true);
    expect(isAllowed("192.168.1.1", tailnetOnly)).toBe(false);
  });

  test.each(["0.0.0.0/0", "8.8.8.0/24", "10.0.0.0/7", "::/0", "2001:db8::/32", "nonsense"])(
    "refuses %s",
    (entry) => {
      expect(() => allowedNetworks(entry)).toThrow(NetworkPolicyError);
    },
  );
});

describe("assertBindingIsPrivate", () => {
  test("accepts a Tailscale or WireGuard address", () => {
    expect(() => assertBindingIsPrivate("100.100.1.1", defaults, {})).not.toThrow();
    expect(() => assertBindingIsPrivate("10.8.0.1", defaults, {})).not.toThrow();
  });

  test("refuses a public address and a host name", () => {
    expect(() => assertBindingIsPrivate("203.0.113.7", defaults, {})).toThrow("not in the allowed private networks");
    expect(() => assertBindingIsPrivate("example.com", defaults, {})).toThrow("must be an IP address");
  });

  test("accepts a wildcard on a machine with only private addresses, as in a container", () => {
    const interfaces = { lo: [iface("127.0.0.1", "IPv4")], eth0: [iface("172.18.0.2", "IPv4")] };
    expect(() => assertBindingIsPrivate("0.0.0.0", defaults, interfaces)).not.toThrow();
  });

  test("refuses a wildcard on a machine with a public address", () => {
    const interfaces = { eth0: [iface("203.0.113.7", "IPv4")], tailscale0: [iface("100.64.0.1", "IPv4")] };
    expect(() => assertBindingIsPrivate("0.0.0.0", defaults, interfaces)).toThrow("203.0.113.7 (eth0)");
  });

  test("checks IPv6 addresses only for the IPv6 wildcard", () => {
    const interfaces = { eth0: [iface("172.18.0.2", "IPv4"), iface("2001:db8::2", "IPv6")] };
    expect(() => assertBindingIsPrivate("0.0.0.0", defaults, interfaces)).not.toThrow();
    expect(() => assertBindingIsPrivate("::", defaults, interfaces)).toThrow("2001:db8::2");
  });
});

describe("checkClient", () => {
  const request = (remoteAddress: string, headers: Record<string, string> = {}) => ({
    socket: { remoteAddress },
    headers,
  });

  test("serves a private source with no forwarding headers", () => {
    expect(checkClient(request("100.64.1.2"), defaults, false)).toEqual({ allowed: true });
  });

  test("refuses a public source", () => {
    expect(checkClient(request("198.51.100.1"), defaults, false)).toEqual({
      allowed: false,
      refused: "198.51.100.1",
      reason: "source",
    });
  });

  test("refuses a public source even when proxied public clients are trusted", () => {
    expect(checkClient(request("198.51.100.1"), defaults, true).allowed).toBe(false);
  });

  test.each([
    { "x-forwarded-for": "100.64.0.9, 203.0.113.5" },
    { "x-real-ip": "203.0.113.5" },
    { forwarded: 'for="[2001:db8::1]:443";proto=https' },
    { "x-forwarded-for": "unknown" },
  ])("refuses a proxied public client: %j", (headers) => {
    expect(checkClient(request("172.18.0.3", headers), defaults, false)).toMatchObject({
      allowed: false,
      reason: "forwarded",
    });
  });

  test("serves proxied private clients", () => {
    const headers = { "x-forwarded-for": "100.64.0.9:5555, 10.0.0.2", forwarded: "for=192.168.1.4" };
    expect(checkClient(request("172.18.0.3", headers), defaults, false)).toEqual({ allowed: true });
  });

  test("serves a proxied public client only with the explicit opt-in", () => {
    const req = request("172.18.0.3", { "x-forwarded-for": "203.0.113.5" });
    expect(checkClient(req, defaults, true)).toEqual({ allowed: true });
  });
});
