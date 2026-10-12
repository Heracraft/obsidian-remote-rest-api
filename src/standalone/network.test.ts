import { allowedNetworks, checkClient, isAllowed, NetworkPolicyError, parseAddress } from "./network";

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

describe("ALLOWED_CLIENT_NETWORKS", () => {
  test("unset allows every client", () => {
    expect(allowedNetworks(undefined)).toBeNull();
    expect(allowedNetworks("  ")).toBeNull();
  });

  test("accepts any network, public ones included", () => {
    const networks = allowedNetworks("100.64.0.0/10, 203.0.113.0/24 2001:db8::/32");
    expect(isAllowed("100.70.1.1", networks)).toBe(true);
    expect(isAllowed("203.0.113.9", networks)).toBe(true);
    expect(isAllowed("2001:db8::5", networks)).toBe(true);
    expect(isAllowed("192.168.1.1", networks)).toBe(false);
  });

  test("refuses an entry that is not a network", () => {
    expect(() => allowedNetworks("nonsense")).toThrow(NetworkPolicyError);
    expect(() => allowedNetworks("10.0.0.0/33")).toThrow(NetworkPolicyError);
  });
});

describe("checkClient", () => {
  const request = (remoteAddress: string) => ({ socket: { remoteAddress } });

  test("serves every client when no allowlist is set", () => {
    expect(checkClient(request("198.51.100.1"), null)).toEqual({ allowed: true });
  });

  test("serves a client inside the allowlist and refuses one outside it", () => {
    const networks = allowedNetworks("100.64.0.0/10");
    expect(checkClient(request("::ffff:100.64.1.2"), networks)).toEqual({ allowed: true });
    expect(checkClient(request("198.51.100.1"), networks)).toEqual({ allowed: false, refused: "198.51.100.1" });
  });
});
