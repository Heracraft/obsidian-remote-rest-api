/** Configuration for the standalone server, from environment variables, the
 *  vault's own Obsidian settings, and a small state file.
 *
 *  Precedence, highest first: an environment variable, then the vault's
 *  `<configDir>/app.json` (for the link and trash preferences Obsidian keeps
 *  there), then the plugin's defaults. The state file holds what the server
 *  generates for itself, the API key and the TLS material, so they survive a
 *  restart. */

import fs from "fs";
import path from "path";
import { DEFAULT_SETTINGS } from "../constants";
import type { CryptoSettings, LocalRestApiSettings } from "../types";
import { allowedNetworks, NetworkPolicyError, type Cidr } from "./network";
import type { NewLinkFormat, TrashOption } from "./obsidian/fileManager";

export const DATA_DIR_NAME = "obsidian-remote-rest-api";

export interface StandaloneConfig {
  vaultPath: string;
  configDir: string;
  dataDir: string;
  updateLinks: boolean;
  newLinkFormat: NewLinkFormat;
  trashOption: TrashOption;
  watch: boolean;
  rescanIntervalSeconds: number;
  tlsCertFile?: string;
  tlsKeyFile?: string;
  /** The networks clients may connect from; see ./network. */
  allowedNetworks: Cidr[];
  /** Whether a request a proxy forwards for a public client is served. Only
   *  for a proxy that authenticates every request itself first. */
  allowPublicClientsThroughAuthenticatingProxy: boolean;
  /** Settings for the request handler, without the generated parts. */
  settings: LocalRestApiSettings;
  /** Whether API_KEY came from the environment. */
  apiKeyFromEnvironment: boolean;
}

/** What the server persists between runs. */
export interface StoredState {
  apiKey?: string;
  crypto?: CryptoSettings;
  /** The binding host and extra names the stored certificate was made for. */
  certificateNames?: string;
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

export function loadConfig(env: Env = process.env): StandaloneConfig {
  const vaultPath = path.resolve(env.VAULT_PATH ?? "/vault");
  const configDir = env.CONFIG_DIR ?? ".obsidian";
  if (configDir === "" || configDir.includes("/") || configDir.includes("\\") || configDir === "." || configDir === "..") {
    throw new ConfigError("CONFIG_DIR must be a single folder name, such as .obsidian.");
  }
  const dataDir = path.resolve(
    env.DATA_DIR ?? path.join(vaultPath, configDir, "plugins", DATA_DIR_NAME),
  );
  const appJson = readAppJson(path.join(vaultPath, configDir, "app.json"));

  const settings: LocalRestApiSettings = {
    ...DEFAULT_SETTINGS,
    port: integer(env, "PORT", DEFAULT_SETTINGS.port),
    insecurePort: integer(env, "INSECURE_PORT", DEFAULT_SETTINGS.insecurePort),
    enableSecureServer: boolean(env, "ENABLE_SECURE_SERVER", true),
    enableInsecureServer: boolean(env, "ENABLE_INSECURE_SERVER", DEFAULT_SETTINGS.enableInsecureServer),
    // Inside a container the server must listen on every interface to be
    // reachable through a published port.
    bindingHost: env.BINDING_HOST ?? "0.0.0.0",
    subjectAltNames: (env.SUBJECT_ALT_NAMES ?? "")
      .split(/[\s,]+/)
      .filter((name) => name.length > 0)
      .join("\n"),
    authorizationHeaderName: env.AUTHORIZATION_HEADER_NAME || undefined,
    enableVerboseLogging: boolean(env, "VERBOSE_LOGGING", false),
    enableSignedUrls: boolean(env, "ENABLE_SIGNED_URLS", DEFAULT_SETTINGS.enableSignedUrls ?? true),
    signedUrlTtlSeconds: optionalInteger(env, "SIGNED_URL_TTL_SECONDS"),
    enableConfigDirAccess: boolean(env, "ENABLE_CONFIG_DIR_ACCESS", false),
  };
  const apiKey = env.API_KEY?.trim();
  if (apiKey) settings.apiKey = apiKey;

  if (!settings.enableSecureServer && !settings.enableInsecureServer) {
    throw new ConfigError("Both servers are turned off: set ENABLE_SECURE_SERVER or ENABLE_INSECURE_SERVER to true.");
  }
  if (settings.enableSecureServer && settings.enableInsecureServer && settings.port === settings.insecurePort) {
    throw new ConfigError("PORT and INSECURE_PORT must differ when both servers are on.");
  }

  const tlsCertFile = env.TLS_CERT_FILE || undefined;
  const tlsKeyFile = env.TLS_KEY_FILE || undefined;
  if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
    throw new ConfigError("Set TLS_CERT_FILE and TLS_KEY_FILE together, or neither.");
  }

  let networks: Cidr[];
  try {
    networks = allowedNetworks(env.ALLOWED_CLIENT_NETWORKS);
  } catch (error) {
    if (error instanceof NetworkPolicyError) throw new ConfigError(error.message);
    throw error;
  }

  return {
    vaultPath,
    configDir,
    dataDir,
    updateLinks: boolean(env, "UPDATE_LINKS_ON_MOVE", appJson.alwaysUpdateLinks ?? true),
    newLinkFormat: oneOf(env, "NEW_LINK_FORMAT", ["shortest", "relative", "absolute"], appJson.newLinkFormat ?? "shortest"),
    trashOption: oneOf(env, "TRASH", ["local", "system", "none"], appJson.trashOption ?? "local"),
    watch: boolean(env, "WATCH", true),
    rescanIntervalSeconds: integer(env, "RESCAN_INTERVAL_SECONDS", 60),
    tlsCertFile,
    tlsKeyFile,
    allowedNetworks: networks,
    allowPublicClientsThroughAuthenticatingProxy: boolean(
      env,
      "ALLOW_PUBLIC_CLIENTS_THROUGH_AUTHENTICATING_PROXY",
      false,
    ),
    settings,
    apiKeyFromEnvironment: Boolean(apiKey),
  };
}

export function readState(dataDir: string): StoredState {
  const file = path.join(dataDir, "data.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(`Could not read ${file}: ${String(error)}`);
  }
}

export function writeState(dataDir: string, state: StoredState): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "data.json");
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

interface AppJson {
  alwaysUpdateLinks?: boolean;
  newLinkFormat?: NewLinkFormat;
  trashOption?: TrashOption;
}

/** The preferences Obsidian keeps in `app.json`, when the folder is a vault
 *  Obsidian has opened. Anything missing or malformed falls back to defaults. */
function readAppJson(file: string): AppJson {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const json = raw as Record<string, unknown>;
  const result: AppJson = {};
  if (typeof json.alwaysUpdateLinks === "boolean") result.alwaysUpdateLinks = json.alwaysUpdateLinks;
  if (json.newLinkFormat === "shortest" || json.newLinkFormat === "relative" || json.newLinkFormat === "absolute") {
    result.newLinkFormat = json.newLinkFormat;
  }
  if (json.trashOption === "local" || json.trashOption === "system" || json.trashOption === "none") {
    result.trashOption = json.trashOption;
  }
  return result;
}

function boolean(env: Env, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new ConfigError(`${name} must be true or false, not '${env[name]}'.`);
}

function integer(env: Env, name: string, fallback: number): number {
  return optionalInteger(env, name) ?? fallback;
}

function optionalInteger(env: Env, name: string): number | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new ConfigError(`${name} must be a whole number, not '${value}'.`);
  return Number(value);
}

function oneOf<T extends string>(env: Env, name: string, allowed: T[], fallback: T): T {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  if ((allowed as string[]).includes(value)) return value as T;
  throw new ConfigError(`${name} must be one of ${allowed.join(", ")}, not '${value}'.`);
}
