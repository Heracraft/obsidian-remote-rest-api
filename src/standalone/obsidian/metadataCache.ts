/** A stand-in for Obsidian's `MetadataCache`: the parsed metadata of each
 *  markdown note, and the link graph between notes.
 *
 *  The vault calls {@link MetadataCache.update} after a note's content changes
 *  and {@link MetadataCache.remove} after one is deleted, both before the
 *  write that caused them returns, so a client that writes and reads back sees
 *  metadata for what it wrote. When files appear, disappear or move, links in
 *  other notes can start or stop resolving, so the whole graph is resolved
 *  again; that is a map lookup per link, with no file reads. */

import { posix } from "path";
import { Events } from "./events";
import { TFile } from "./files";
import { parseNote, type CachedMetadata, type LinkReference } from "./parse";

/** What the cache needs from the vault: the current list of files. */
export interface FileSource {
  getFiles(): TFile[];
}

interface Entry {
  cache: CachedMetadata;
  references: LinkReference[];
  /** The stat the entry was parsed at; an unchanged stat skips a reparse. */
  mtime: number;
  size: number;
}

interface NameIndex {
  byPath: Map<string, TFile>;
  byName: Map<string, TFile[]>;
}

export class MetadataCache extends Events {
  private resolved: Record<string, Record<string, number>> = {};
  private unresolved: Record<string, Record<string, number>> = {};
  /** Set when files appeared, moved or went away: every note's links are
   *  resolved again on the next read of the graph rather than once per change,
   *  so a thousand files arriving at once cost one pass, not a thousand. */
  private graphIsStale = true;

  private entries = new Map<string, Entry>();
  private nameIndex: NameIndex | null = null;

  get resolvedLinks(): Record<string, Record<string, number>> {
    this.settleGraph();
    return this.resolved;
  }

  get unresolvedLinks(): Record<string, Record<string, number>> {
    this.settleGraph();
    return this.unresolved;
  }

  constructor(private readonly files: FileSource) {
    super();
  }

  getFileCache(file: TFile): CachedMetadata | null {
    return this.entries.get(file.path)?.cache ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    return this.entries.get(path)?.cache ?? null;
  }

  /** The links in a note, with their offsets, for rewriting on rename. */
  getReferences(path: string): LinkReference[] {
    return this.entries.get(path)?.references ?? [];
  }

  /** Whether the cached entry for `file` was parsed at its current stat. */
  isFresh(file: TFile): boolean {
    const entry = this.entries.get(file.path);
    return entry !== undefined && entry.mtime === file.stat.mtime && entry.size === file.stat.size;
  }

  /** Parse a note's new content and announce it. Emits `changed`, then
   *  `resolve` for the note, then `resolved`, in Obsidian's order. */
  update(file: TFile, content: string, announce = true): void {
    const { cache, references } = parseNote(content);
    this.entries.set(file.path, {
      cache,
      references,
      mtime: file.stat.mtime,
      size: file.stat.size,
    });
    this.resolveFile(file.path);
    if (!announce) return;
    this.trigger("changed", file, content, cache);
    this.trigger("resolve", file);
    this.trigger("resolved");
  }

  /** Forget a deleted note. Emits `deleted` with its last metadata. */
  remove(file: TFile): void {
    const entry = this.entries.get(file.path);
    this.entries.delete(file.path);
    delete this.resolved[file.path];
    delete this.unresolved[file.path];
    if (entry && file.extension === "md") {
      this.trigger("deleted", file, entry.cache);
    }
  }

  /** Move a note's entry to its new path after a rename. */
  move(oldPath: string, newPath: string): void {
    const entry = this.entries.get(oldPath);
    if (!entry) return;
    this.entries.delete(oldPath);
    this.entries.set(newPath, entry);
    delete this.resolved[oldPath];
    delete this.unresolved[oldPath];
  }

  /** Called when the set of files changed: links may now resolve differently. */
  filesChanged(): void {
    this.nameIndex = null;
    this.graphIsStale = true;
    this.trigger("resolved");
  }

  private settleGraph(): void {
    if (!this.graphIsStale) return;
    this.graphIsStale = false;
    this.resolved = {};
    this.unresolved = {};
    for (const path of this.entries.keys()) this.resolveFile(path);
  }

  /** Where a link from `sourcePath` leads, by Obsidian's rules as far as they
   *  are known: a path relative to the note (`./`, `../`), then an exact vault
   *  path, with or without `.md`, then a file whose name or trailing path
   *  matches. Ties go to a file in the source's folder, then the shortest path,
   *  then the alphabetically first. Case is ignored throughout. */
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    let target = linkpath.trim();
    if (target === "") return null;
    const index = this.index();
    const exact = (candidate: string): TFile | null => {
      const key = candidate.toLowerCase();
      return index.byPath.get(key) ?? index.byPath.get(key + ".md") ?? null;
    };

    const sourceDir = posix.dirname(sourcePath);
    if (target.startsWith("./") || target.startsWith("../")) {
      const joined = posix.normalize(posix.join(sourceDir === "." ? "" : sourceDir, target));
      if (joined.startsWith("../")) return null;
      return exact(joined);
    }
    if (target.startsWith("/")) target = target.slice(1);

    const direct = exact(target);
    if (direct) return direct;

    const key = target.toLowerCase();
    let candidates: TFile[];
    if (key.includes("/")) {
      candidates = [];
      for (const [path, file] of index.byPath) {
        if (path.endsWith("/" + key) || path.endsWith("/" + key + ".md")) candidates.push(file);
      }
    } else {
      candidates = index.byName.get(key) ?? [];
    }
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
      const aLocal = posix.dirname(a.path) === sourceDir ? 0 : 1;
      const bLocal = posix.dirname(b.path) === sourceDir ? 0 : 1;
      if (aLocal !== bLocal) return aLocal - bLocal;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    })[0];
  }

  /** How a link to `file` is written in "shortest path" form: its name alone
   *  when no other file shares it, otherwise its vault path, as Obsidian
   *  writes them. Markdown files lose their `.md`. */
  fileToLinktext(file: TFile, _sourcePath: string, omitMdExtension = true): string {
    const strip = (value: string): string =>
      omitMdExtension && file.extension === "md" ? value.slice(0, -3) : value;
    const key = (file.extension === "md" ? file.basename : file.name).toLowerCase();
    const sameName = this.index().byName.get(key) ?? [];
    const unique = sameName.every((other) => other === file);
    return strip(unique ? file.name : file.path);
  }

  private resolveFile(sourcePath: string): void {
    if (this.graphIsStale) return;
    const entry = this.entries.get(sourcePath);
    if (!entry) return;
    const resolved: Record<string, number> = {};
    const unresolved: Record<string, number> = {};
    for (const reference of entry.references) {
      if (reference.linkpath === "") continue;
      const target = this.getFirstLinkpathDest(reference.linkpath, sourcePath);
      if (target) {
        resolved[target.path] = (resolved[target.path] ?? 0) + 1;
      } else {
        unresolved[reference.linkpath] = (unresolved[reference.linkpath] ?? 0) + 1;
      }
    }
    this.resolved[sourcePath] = resolved;
    this.unresolved[sourcePath] = unresolved;
  }

  private index(): NameIndex {
    if (this.nameIndex) return this.nameIndex;
    const byPath = new Map<string, TFile>();
    const byName = new Map<string, TFile[]>();
    const add = (key: string, file: TFile): void => {
      const list = byName.get(key) ?? [];
      list.push(file);
      byName.set(key, list);
    };
    for (const file of this.files.getFiles()) {
      byPath.set(file.path.toLowerCase(), file);
      add(file.name.toLowerCase(), file);
      if (file.extension === "md") add(file.basename.toLowerCase(), file);
    }
    this.nameIndex = { byPath, byName };
    return this.nameIndex;
  }
}
