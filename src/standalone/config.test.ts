import fs from "fs";
import os from "os";
import path from "path";
import { ConfigError, loadConfig, readState, writeState } from "./config";

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("defaults suit a container with the vault mounted at VAULT_PATH", () => {
    const config = loadConfig({ VAULT_PATH: vault });
    expect(config.vaultPath).toBe(vault);
    expect(config.configDir).toBe(".obsidian");
    expect(config.dataDir).toBe(path.join(vault, ".obsidian", "plugins", "obsidian-remote-rest-api"));
    expect(config.settings).toMatchObject({
      port: 27124,
      insecurePort: 27123,
      enableSecureServer: true,
      enableInsecureServer: false,
      bindingHost: "0.0.0.0",
      enableSignedUrls: true,
      enableConfigDirAccess: false,
    });
    expect(config.settings.apiKey).toBeUndefined();
    expect(config).toMatchObject({
      updateLinks: true,
      newLinkFormat: "shortest",
      trashOption: "local",
      watch: true,
      rescanIntervalSeconds: 60,
      apiKeyFromEnvironment: false,
    });
  });

  test("reads every setting from the environment", () => {
    const config = loadConfig({
      VAULT_PATH: vault,
      DATA_DIR: "/data",
      API_KEY: " secret ",
      PORT: "1",
      INSECURE_PORT: "2",
      ENABLE_SECURE_SERVER: "false",
      ENABLE_INSECURE_SERVER: "yes",
      BINDING_HOST: "127.0.0.1",
      SUBJECT_ALT_NAMES: "notes.lan, 10.0.0.2 other",
      AUTHORIZATION_HEADER_NAME: "X-Key",
      VERBOSE_LOGGING: "1",
      ENABLE_SIGNED_URLS: "off",
      SIGNED_URL_TTL_SECONDS: "600",
      ENABLE_CONFIG_DIR_ACCESS: "true",
      UPDATE_LINKS_ON_MOVE: "false",
      NEW_LINK_FORMAT: "relative",
      TRASH: "none",
      WATCH: "false",
      RESCAN_INTERVAL_SECONDS: "0",
    });
    expect(config.dataDir).toBe("/data");
    expect(config.apiKeyFromEnvironment).toBe(true);
    expect(config.settings).toMatchObject({
      apiKey: "secret",
      port: 1,
      insecurePort: 2,
      enableSecureServer: false,
      enableInsecureServer: true,
      bindingHost: "127.0.0.1",
      subjectAltNames: "notes.lan\n10.0.0.2\nother",
      authorizationHeaderName: "X-Key",
      enableVerboseLogging: true,
      enableSignedUrls: false,
      signedUrlTtlSeconds: 600,
      enableConfigDirAccess: true,
    });
    expect(config).toMatchObject({
      updateLinks: false,
      newLinkFormat: "relative",
      trashOption: "none",
      watch: false,
      rescanIntervalSeconds: 0,
    });
  });

  test("takes link and trash preferences from the vault's app.json", () => {
    fs.mkdirSync(path.join(vault, ".obsidian"));
    fs.writeFileSync(
      path.join(vault, ".obsidian", "app.json"),
      JSON.stringify({ alwaysUpdateLinks: false, newLinkFormat: "absolute", trashOption: "none" }),
    );
    expect(loadConfig({ VAULT_PATH: vault })).toMatchObject({
      updateLinks: false,
      newLinkFormat: "absolute",
      trashOption: "none",
    });
    // The environment still wins.
    expect(loadConfig({ VAULT_PATH: vault, TRASH: "local" }).trashOption).toBe("local");
  });

  test.each([
    [{ PORT: "abc" }, "PORT must be a whole number"],
    [{ WATCH: "maybe" }, "WATCH must be true or false"],
    [{ TRASH: "bin" }, "TRASH must be one of"],
    [{ CONFIG_DIR: "a/b" }, "CONFIG_DIR must be a single folder name"],
    [{ ENABLE_SECURE_SERVER: "false" }, "Both servers are turned off"],
    [{ ENABLE_INSECURE_SERVER: "true", INSECURE_PORT: "27124" }, "must differ"],
    [{ TLS_CERT_FILE: "/cert.pem" }, "TLS_CERT_FILE and TLS_KEY_FILE together"],
    [{ ALLOWED_CLIENT_NETWORKS: "0.0.0.0/0" }, "may only name private networks"],
    [{ ALLOW_PUBLIC_CLIENTS_THROUGH_AUTHENTICATING_PROXY: "true" }, "no longer supported"],
  ])("refuses %j", (env, message) => {
    expect(() => loadConfig({ VAULT_PATH: vault, ...env })).toThrow(ConfigError);
    expect(() => loadConfig({ VAULT_PATH: vault, ...env })).toThrow(message);
  });
});

test("network policy defaults to the private networks and can be narrowed", () => {
  const config = loadConfig({ VAULT_PATH: vault });
  expect(config.allowedNetworks.map((network) => network.text)).toContain("100.64.0.0/10");
  const narrowed = loadConfig({ VAULT_PATH: vault, ALLOWED_CLIENT_NETWORKS: "100.64.0.0/10" });
  expect(narrowed.allowedNetworks.map((network) => network.text)).toEqual(["100.64.0.0/10"]);
});

describe("state file", () => {
  test("round-trips, readable only by its owner", () => {
    const dataDir = path.join(vault, "state");
    expect(readState(dataDir)).toEqual({});
    writeState(dataDir, { apiKey: "k" });
    expect(readState(dataDir)).toEqual({ apiKey: "k" });
    expect(fs.statSync(path.join(dataDir, "data.json")).mode & 0o777).toBe(0o600);
  });
});
