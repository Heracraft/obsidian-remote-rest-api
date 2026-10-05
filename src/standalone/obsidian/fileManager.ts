/** A stand-in for Obsidian's `FileManager`: moves that keep links working,
 *  and deletion that follows the vault's trash preference. */

import { posix } from "path";
import { TAbstractFile, TFile, TFolder } from "./files";
import type { LinkReference } from "./parse";
import type { Vault } from "./vault";

export type NewLinkFormat = "shortest" | "relative" | "absolute";
export type TrashOption = "local" | "system" | "none";

export interface FileManagerOptions {
  /** Rewrite links to a file when it moves (Obsidian's "Automatically update
   *  internal links"). */
  updateLinks: boolean;
  /** How rewritten links name their target (Obsidian's "New link format"). */
  newLinkFormat: NewLinkFormat;
  /** Where deleted files go (Obsidian's "Deleted files"): the vault's
   *  `.trash` folder, the system trash (which a container does not have, so
   *  `.trash` again), or nowhere. */
  trashOption: TrashOption;
}

interface PendingRewrite {
  source: TFile;
  reference: LinkReference;
  target: TFile;
}

export class FileManager {
  constructor(
    private readonly vault: Vault,
    readonly options: FileManagerOptions,
  ) {}

  async trashFile(file: TAbstractFile): Promise<void> {
    if (this.options.trashOption === "none") {
      await this.vault.delete(file, true);
    } else {
      await this.vault.trash(file, this.options.trashOption === "system");
    }
  }

  /** Move a file or folder and, when link updating is on, rewrite every link
   *  that pointed into it so it points at the new location. A link whose text
   *  changed on disk between the move and the rewrite is left as it is. */
  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    const pending = this.options.updateLinks ? this.linksInto(file) : [];
    await this.vault.rename(file, newPath);
    if (pending.length === 0) return;

    const bySource = new Map<TFile, PendingRewrite[]>();
    for (const rewrite of pending) {
      const list = bySource.get(rewrite.source) ?? [];
      list.push(rewrite);
      bySource.set(rewrite.source, list);
    }
    for (const [source, rewrites] of bySource) {
      // The source may itself have moved; the TFile carries its current path.
      if (!this.vault.getFileByPath(source.path)) continue;
      let content: string;
      try {
        content = await this.vault.read(source);
      } catch {
        continue;
      }
      let changed = false;
      // Last first, so earlier offsets stay valid as text changes length.
      for (const { reference, target } of [...rewrites].sort((a, b) => b.reference.start - a.reference.start)) {
        if (content.slice(reference.start, reference.end) !== reference.original) continue;
        const replacement = this.rewriteLink(reference, target, source.path);
        if (replacement === reference.original) continue;
        content = content.slice(0, reference.start) + replacement + content.slice(reference.end);
        changed = true;
      }
      if (changed) await this.vault.modify(source, content);
    }
  }

  /** How a link to `file` is written from `sourcePath` under the configured
   *  link format. Markdown files drop `.md` unless `keepExtension`. */
  linkPathFor(file: TFile, sourcePath: string, keepExtension: boolean): string {
    const strip = (value: string): string =>
      !keepExtension && file.extension === "md" ? value.slice(0, -3) : value;
    switch (this.options.newLinkFormat) {
      case "absolute":
        return strip(file.path);
      case "relative": {
        const from = posix.dirname(sourcePath);
        const relative = posix.relative(from === "." ? "" : from, file.path);
        return strip(relative);
      }
      default: {
        const shortest = this.vault.metadataCache.fileToLinktext(file, sourcePath, true);
        if (!keepExtension || file.extension !== "md") return shortest;
        return shortest.endsWith(".md") ? shortest : shortest + ".md";
      }
    }
  }

  private rewriteLink(reference: LinkReference, target: TFile, sourcePath: string): string {
    if (reference.syntax === "wikilink") {
      const separator = reference.original.includes("\\|") ? "\\|" : "|";
      const alias = reference.alias === undefined ? "" : separator + reference.alias;
      return `${reference.embed ? "!" : ""}[[${this.linkPathFor(target, sourcePath, false)}${reference.subpath}${alias}]]`;
    }
    const destination = reference.destination ?? "";
    const wrapped = destination.startsWith("<");
    const linkPath = this.linkPathFor(target, sourcePath, true);
    const encoded = wrapped
      ? `<${linkPath}${reference.subpath}>`
      : encodeURI(linkPath).replace(/\(/g, "%28").replace(/\)/g, "%29") + encodeSubpath(reference.subpath);
    const at = reference.original.indexOf("](");
    const head = reference.original.slice(0, at + 2);
    const tail = reference.original.slice(at + 2);
    const offset = tail.indexOf(destination);
    if (offset === -1) return reference.original;
    return head + tail.slice(0, offset) + encoded + tail.slice(offset + destination.length);
  }

  /** Every link anywhere in the vault that resolves to `file`, or to a file
   *  inside it when it is a folder, captured before the move. */
  private linksInto(file: TAbstractFile): PendingRewrite[] {
    const targets = new Set<TFile>();
    const collect = (entry: TAbstractFile): void => {
      if (entry instanceof TFile) targets.add(entry);
      else if (entry instanceof TFolder) entry.children.forEach(collect);
    };
    collect(file);
    if (targets.size === 0) return [];
    const targetPaths = new Set([...targets].map((target) => target.path));

    const cache = this.vault.metadataCache;
    const pending: PendingRewrite[] = [];
    for (const [sourcePath, links] of Object.entries(cache.resolvedLinks)) {
      if (!Object.keys(links).some((path) => targetPaths.has(path))) continue;
      const source = this.vault.getFileByPath(sourcePath);
      if (!source) continue;
      for (const reference of cache.getReferences(sourcePath)) {
        // `[[#heading]]` points into the note it sits in, wherever that is.
        if (reference.linkpath === "") continue;
        const target = cache.getFirstLinkpathDest(reference.linkpath, sourcePath);
        if (target && targets.has(target)) pending.push({ source, reference, target });
      }
    }
    return pending;
  }
}

function encodeSubpath(subpath: string): string {
  if (subpath === "") return "";
  return "#" + encodeURI(subpath.slice(1));
}
