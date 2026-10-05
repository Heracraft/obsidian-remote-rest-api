/** Entry point of the standalone server: the plugin's REST API and MCP server
 *  over a plain folder, with no Obsidian app running.
 *
 *  The request handler, MCP handler and vault operations are the plugin's own
 *  code. They import "obsidian", which the build points at ./obsidian, a
 *  filesystem-backed implementation of the parts of Obsidian's API they use. */

import "./globals";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import forge from "node-forge";
import type { App as ObsidianApp, PluginManifest } from "obsidian";

import RequestHandler from "../requestHandler";
import { buildServerCertificateChain, generateCryptoSettings, renewServerCertificateIfNeeded } from "../certificates";
import { configureHttpServerTimeouts } from "../serverTimeouts";
import type { CryptoSettings } from "../types";
import { ConfigError, loadConfig, readState, writeState, type StandaloneConfig } from "./config";
import { SharpImageScaler } from "./imageScaler";
import { assertBindingIsPrivate, checkClient, NetworkPolicyError } from "./network";
import { App } from "./obsidian";
import { watchVault } from "./watch";

declare const STANDALONE_VERSION: string;

const log = (message: string): void => console.log(`[REST API] ${message}`);

async function main(): Promise<void> {
  let config: StandaloneConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[REST API] ${error.message}`);
      process.exit(2);
    }
    throw error;
  }

  try {
    assertBindingIsPrivate(config.settings.bindingHost ?? "0.0.0.0", config.allowedNetworks);
  } catch (error) {
    if (error instanceof NetworkPolicyError) {
      console.error(`[REST API] Refusing to start. ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
  if (config.allowPublicClientsThroughAuthenticatingProxy) {
    console.warn(
      "[REST API] WARNING: ALLOW_PUBLIC_CLIENTS_THROUGH_AUTHENTICATING_PROXY is on. Requests a proxy forwards for " +
        "clients on the public internet will be served. Anyone who gets past that proxy, or reaches this server " +
        "around it, can read, change and delete every note with one leaked API key. Make sure the proxy " +
        "authenticates every request on this route (forward auth, mTLS, an SSO gateway) before it is forwarded.",
    );
  }

  const vaultStat = fs.statSync(config.vaultPath, { throwIfNoEntry: false });
  if (!vaultStat?.isDirectory()) {
    console.error(`[REST API] The vault folder ${config.vaultPath} does not exist. Mount a folder there or set VAULT_PATH.`);
    process.exit(2);
  }

  const app = new App({
    vaultPath: fs.realpathSync(config.vaultPath),
    configDir: config.configDir,
    updateLinks: config.updateLinks,
    newLinkFormat: config.newLinkFormat,
    trashOption: config.trashOption,
  });
  const started = Date.now();
  await app.vault.load();
  log(
    `Indexed ${app.vault.getFiles().length} files (${app.vault.getMarkdownFiles().length} notes) ` +
      `in ${config.vaultPath} in ${Date.now() - started} ms`,
  );

  const settings = { ...config.settings };
  const state = readState(config.dataDir);
  let stateChanged = false;

  if (!settings.apiKey) {
    if (state.apiKey) {
      settings.apiKey = state.apiKey;
    } else {
      settings.apiKey = forge.md.sha256.create().update(forge.random.getBytesSync(128)).digest().toHex();
      state.apiKey = settings.apiKey;
      stateChanged = true;
      log(`Generated an API key and saved it to ${path.join(config.dataDir, "data.json")}`);
      log(`API key: ${settings.apiKey}`);
    }
  }

  if (settings.enableSecureServer) {
    const crypto = loadTlsMaterial(config, state);
    if (crypto.changed) stateChanged = true;
    settings.crypto = crypto.material;
  }

  if (stateChanged) writeState(config.dataDir, state);

  const manifest: PluginManifest = {
    id: "obsidian-remote-rest-api",
    name: "Remote REST API",
    version: STANDALONE_VERSION,
    minAppVersion: "0.0.0",
    description: "The Local REST API and MCP server for a folder of markdown notes, without Obsidian.",
    author: "Adam Coddington, Heracraft",
    isDesktopOnly: false,
  };

  const handler = new RequestHandler(app as unknown as ObsidianApp, manifest, settings, undefined, {
    imageScaler: new SharpImageScaler(),
  });
  handler.setupRouter();

  // Every request passes the network gate before the API sees it. A refusal
  // is a bare 403 that says why, sent before authentication, so a client
  // outside the allowed networks learns nothing about the API behind it.
  const gated: http.RequestListener = (req, res) => {
    const verdict = checkClient(req, config.allowedNetworks, config.allowPublicClientsThroughAuthenticatingProxy);
    if (verdict.allowed) {
      handler.api(req, res);
      return;
    }
    if (settings.enableVerboseLogging || verdict.reason === "source") {
      log(`Refused a request from ${verdict.refused ?? "unknown"} (${verdict.reason === "source" ? "source address" : "forwarded client"} outside the allowed networks)`);
    }
    res.writeHead(403, { "Content-Type": "application/json", Connection: "close" });
    res.end(
      JSON.stringify({
        message:
          verdict.reason === "source"
            ? "This server only answers clients on private networks (Tailscale, WireGuard, LAN)."
            : "This server does not answer requests forwarded for clients on the public internet.",
        errorCode: 40322,
      }),
    );
  };

  const servers: http.Server[] = [];
  const host = settings.bindingHost ?? "0.0.0.0";
  const shownHost = host.includes(":") ? `[${host}]` : host;
  if (settings.enableSecureServer && settings.crypto) {
    const server = https.createServer(
      { key: settings.crypto.privateKey, cert: buildServerCertificateChain(settings.crypto) },
      gated,
    );
    configureHttpServerTimeouts(server);
    server.listen(settings.port, host, () => log(`Listening on https://${shownHost}:${settings.port}/`));
    servers.push(server);
  }
  if (settings.enableInsecureServer) {
    const server = http.createServer(gated);
    configureHttpServerTimeouts(server);
    server.listen(settings.insecurePort, host, () => log(`Listening on http://${shownHost}:${settings.insecurePort}/`));
    servers.push(server);
  }
  for (const server of servers) {
    server.on("error", (error) => {
      console.error("[REST API] Server error:", error);
      process.exit(1);
    });
  }

  const stopWatching = config.watch ? watchVault(app.vault, settings.enableVerboseLogging ?? false) : () => {};
  const rescan =
    config.rescanIntervalSeconds > 0
      ? setInterval(() => {
          app.vault.reconcile().catch((error) => console.error("[REST API] Rescan failed:", error));
        }, config.rescanIntervalSeconds * 1000)
      : null;
  rescan?.unref();

  const shutdown = (signal: string): void => {
    log(`Received ${signal}, shutting down`);
    stopWatching();
    if (rescan) clearInterval(rescan);
    handler.mcpHandler.close();
    handler.operations.dispose();
    handler.events.dispose();
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/** The TLS material for the HTTPS server: files named by TLS_CERT_FILE and
 *  TLS_KEY_FILE when given, otherwise a certificate authority and server
 *  certificate generated once and kept in the state file. Generated material
 *  is made again when the names it must cover change, and its server
 *  certificate is renewed from the same authority as it nears expiry. */
function loadTlsMaterial(
  config: StandaloneConfig,
  state: { crypto?: CryptoSettings; certificateNames?: string },
): { material: CryptoSettings; changed: boolean } {
  if (config.tlsCertFile && config.tlsKeyFile) {
    return {
      material: {
        cert: fs.readFileSync(config.tlsCertFile, "utf8"),
        privateKey: fs.readFileSync(config.tlsKeyFile, "utf8"),
        publicKey: "",
      },
      changed: false,
    };
  }
  const options = {
    bindingHost: config.settings.bindingHost,
    subjectAltNames: config.settings.subjectAltNames,
  };
  const names = `${options.bindingHost ?? ""}|${options.subjectAltNames ?? ""}`;
  if (!state.crypto || state.certificateNames !== names) {
    if (state.crypto) {
      log("The certificate names changed (BINDING_HOST or SUBJECT_ALT_NAMES); generating a new certificate authority");
    } else {
      log("Generating a certificate authority and server certificate");
    }
    state.crypto = generateCryptoSettings(options);
    state.certificateNames = names;
    return { material: state.crypto, changed: true };
  }
  const renewed = renewServerCertificateIfNeeded(state.crypto, options);
  if (renewed) {
    log("Renewed the server certificate from the stored certificate authority");
    state.crypto = renewed;
    return { material: renewed, changed: true };
  }
  return { material: state.crypto, changed: false };
}

main().catch((error) => {
  console.error("[REST API] Failed to start:", error);
  process.exit(1);
});
