/** Obsidian's file tree objects. The vault hands out one object per path and
 *  mutates it in place on rename, so a caller holding a `TFile` sees its new
 *  path afterwards, the way Obsidian's own objects behave. */

import { posix } from "path";

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export abstract class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null = null;

  constructor(path: string) {
    this.path = path;
    this.name = path === "/" ? "" : posix.basename(path);
  }

  /** Point this object at a new path, as Obsidian does on rename. */
  setPath(path: string): void {
    this.path = path;
    this.name = posix.basename(path);
  }
}

export class TFile extends TAbstractFile {
  stat: FileStats;
  basename: string;
  extension: string;

  constructor(path: string, stat: FileStats) {
    super(path);
    this.stat = stat;
    this.basename = "";
    this.extension = "";
    this.setPath(path);
  }

  override setPath(path: string): void {
    super.setPath(path);
    const dot = this.name.lastIndexOf(".");
    // A leading dot is part of the name, not an extension separator.
    if (dot > 0) {
      this.basename = this.name.slice(0, dot);
      this.extension = this.name.slice(dot + 1);
    } else {
      this.basename = this.name;
      this.extension = "";
    }
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "/";
  }
}

/** Collapse a vault path the way Obsidian's `normalizePath` does: forward
 *  slashes, no doubled or leading/trailing slashes, NFC. The empty path and "/"
 *  both mean the vault root, which Obsidian spells "/". */
export function normalizePath(path: string): string {
  const collapsed = path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .normalize("NFC");
  return collapsed === "" ? "/" : collapsed;
}
