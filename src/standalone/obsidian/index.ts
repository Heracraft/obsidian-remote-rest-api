/** The `obsidian` module, as the standalone server sees it.
 *
 *  The plugin's code imports from "obsidian", a module that only exists inside
 *  the Obsidian app. The standalone build points that import here instead
 *  (see `esbuild.config.mjs`), and this module implements the part of the API
 *  the server uses on top of a plain folder. Type-checking still runs against
 *  the real `obsidian` typings, so the plugin code is held to Obsidian's API
 *  and this module to the behaviour that code relies on. */

import { Events } from "./events";
import { FileSystemAdapter } from "./adapter";
import { FileManager, type FileManagerOptions } from "./fileManager";
import { TFile } from "./files";
import type { CachedMetadata } from "./parse";
import { Vault } from "./vault";

export { Events, type EventRef } from "./events";
export { DataAdapter, FileSystemAdapter, type Stat as FileStatsWithType } from "./adapter";
export { FileManager } from "./fileManager";
export { normalizePath, TAbstractFile, TFile, TFolder, type FileStats } from "./files";
export { MetadataCache } from "./metadataCache";
export type { CachedMetadata, HeadingCache, LinkCache, TagCache } from "./parse";
export { prepareSimpleSearch, type SearchResult } from "./search";
export { Component, MarkdownRenderer } from "./render";
export { Vault } from "./vault";

/** Reported as `versions.obsidian` by `GET /`. There is no Obsidian here; the
 *  value says which API this module stands in for. */
export const apiVersion = "standalone";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
  dir?: string;
}

/** The workspace is the Obsidian window. Without one there is no active file
 *  and nothing is ever opened; the events object exists so subscribers can
 *  attach to it without special cases. */
export class Workspace extends Events {
  getActiveFile(): TFile | null {
    return null;
  }

  async openLinkText(): Promise<void> {
    throw new Error("There is no Obsidian window to open a file in.");
  }
}

export interface AppOptions extends FileManagerOptions {
  vaultPath: string;
  configDir: string;
}

export class App {
  readonly vault: Vault;
  readonly metadataCache: Vault["metadataCache"];
  readonly fileManager: FileManager;
  readonly workspace = new Workspace();
  readonly commands = {
    commands: {} as Record<string, { id: string; name: string }>,
    executeCommandById: (_id: string): boolean => false,
  };
  readonly plugins = {
    plugins: {} as Record<string, unknown>,
    getPlugin: (_id: string): null => null,
  };
  readonly internalPlugins = {
    plugins: {} as Record<string, unknown>,
    getPluginById: (_id: string): null => null,
  };

  constructor(options: AppOptions) {
    const adapter = new FileSystemAdapter(options.vaultPath);
    this.vault = new Vault(adapter, options.configDir);
    this.metadataCache = this.vault.metadataCache;
    this.fileManager = new FileManager(this.vault, options);
  }
}

/** Every tag in a note, frontmatter included, each with a leading `#`, as
 *  Obsidian's `getAllTags` returns them. Frontmatter `tags` and `tag` may be a
 *  list or a string of names separated by commas or spaces. */
export function getAllTags(cache: CachedMetadata): string[] | null {
  const tags: string[] = [];
  const frontmatter = cache.frontmatter ?? {};
  for (const key of ["tags", "tag"]) {
    const value = frontmatter[key];
    const names = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,\s]+/)
        : [];
    for (const name of names) {
      if (typeof name !== "string" && typeof name !== "number") continue;
      const text = String(name).trim();
      if (text === "") continue;
      tags.push(text.startsWith("#") ? text : "#" + text);
    }
  }
  for (const tag of cache.tags ?? []) tags.push(tag.tag);
  return tags.length > 0 ? tags : null;
}
