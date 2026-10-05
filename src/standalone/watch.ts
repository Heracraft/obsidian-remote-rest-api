/** Follow changes made to the vault folder by anything other than this
 *  server: a sync client, an editor, `git pull`.
 *
 *  Node's recursive `fs.watch` reports a path that changed; the vault then
 *  compares that path with its index and announces what is different. Events
 *  arrive in bursts while a file is written, so each path is settled once
 *  its events have been quiet for a moment. A change the watcher misses is
 *  caught by the periodic rescan in the entry point. */

import fs from "fs";
import type { Vault } from "./obsidian";

const SETTLE_MS = 150;

export function watchVault(vault: Vault, verbose: boolean): () => void {
  const pending = new Map<string, NodeJS.Timeout>();
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(vault.adapter.getBasePath(), { recursive: true, persistent: false });
  } catch (error) {
    console.warn("[REST API] Could not watch the vault folder; relying on the periodic rescan:", error);
    return () => {};
  }

  const settle = (path: string): void => {
    pending.delete(path);
    vault.sync(path).catch((error) => console.error(`[REST API] Could not index ${path}:`, error));
  };

  watcher.on("change", (_event, filename) => {
    if (filename === null || filename === undefined) {
      vault.reconcile().catch((error) => console.error("[REST API] Rescan failed:", error));
      return;
    }
    const path = filename.toString().split("\\").join("/");
    if (vault.isHidden(path)) return;
    if (verbose) console.debug(`[REST API] Changed on disk: ${path}`);
    const timer = pending.get(path);
    if (timer) clearTimeout(timer);
    pending.set(path, setTimeout(() => settle(path), SETTLE_MS));
  });
  watcher.on("error", (error) => {
    console.warn("[REST API] The vault watcher stopped; relying on the periodic rescan:", error);
  });

  return () => {
    watcher.close();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
}
