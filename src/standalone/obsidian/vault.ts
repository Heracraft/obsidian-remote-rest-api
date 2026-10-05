/** A stand-in for Obsidian's `Vault`: an index of the files under one folder,
 *  kept in step with the disk, and the file operations the API performs.
 *
 *  Like Obsidian, the index leaves out every file and folder whose name
 *  starts with a dot, the configuration directory included. Those stay
 *  reachable through the adapter, where the API's own guards decide.
 *
 *  Every change to the index goes through {@link Vault.sync}, which compares
 *  the disk with the index and announces the difference: `create`, `modify`,
 *  `delete`. The adapter calls it after its own writes, and the watcher calls
 *  it for changes made by anything else, so a change is announced once
 *  whichever of the two sees it first. */

import fs from "fs";
import { posix } from "path";
import { Events } from "./events";
import { FileSystemAdapter, errorCode, toStat, type Stat } from "./adapter";
import { normalizePath, TAbstractFile, TFile, TFolder } from "./files";
import { MetadataCache } from "./metadataCache";

export class Vault extends Events {
  readonly metadataCache: MetadataCache;
  private readonly fileMap = new Map<string, TAbstractFile>();
  private readonly root = new TFolder("/");
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly adapter: FileSystemAdapter,
    readonly configDir: string,
  ) {
    super();
    this.fileMap.set("/", this.root);
    this.metadataCache = new MetadataCache(this);
    adapter.afterChange = (path) => this.sync(path);
  }

  getName(): string {
    return this.adapter.getName();
  }

  getRoot(): TFolder {
    return this.root;
  }

  /** Index everything under the vault folder. Quiet: nothing is announced for
   *  files that were already there when the server started. */
  async load(): Promise<void> {
    await this.serialized(async () => {
      await this.scanFolder(this.root, false, new Set());
      this.metadataCache.filesChanged();
    });
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.fileMap.get(normalizePath(path)) ?? null;
  }

  getFileByPath(path: string): TFile | null {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  getFolderByPath(path: string): TFolder | null {
    const folder = this.getAbstractFileByPath(path);
    return folder instanceof TFolder ? folder : null;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return [...this.fileMap.values()];
  }

  getFiles(): TFile[] {
    const files: TFile[] = [];
    for (const entry of this.fileMap.values()) {
      if (entry instanceof TFile) files.push(entry);
    }
    return files;
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((file) => file.extension === "md");
  }

  async read(file: TFile): Promise<string> {
    return this.adapter.read(file.path);
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.adapter.read(file.path);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return this.adapter.readBinary(file.path);
  }

  async modify(file: TFile, data: string): Promise<void> {
    await this.adapter.write(file.path, data);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    await this.adapter.writeBinary(file.path, data);
  }

  async append(file: TFile, data: string): Promise<void> {
    await this.adapter.append(file.path, data);
  }

  async create(path: string, data: string): Promise<TFile> {
    const normalized = normalizePath(path);
    if (await this.adapter.exists(normalized)) throw new Error("File already exists.");
    await this.adapter.write(normalized, data);
    return this.mustBeFile(normalized);
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const normalized = normalizePath(path);
    if (await this.adapter.exists(normalized)) throw new Error("File already exists.");
    await this.adapter.writeBinary(normalized, data);
    return this.mustBeFile(normalized);
  }

  async createFolder(path: string): Promise<TFolder> {
    let normalized = normalizePath(path);
    if (normalized === ".") normalized = "/";
    if (await this.adapter.exists(normalized)) throw new Error("Folder already exists.");
    await this.adapter.mkdir(normalized);
    const folder = this.getFolderByPath(normalized);
    if (!folder) throw new Error(`Folder was created but is not indexed: ${normalized}`);
    return folder;
  }

  async copy(file: TFile, newPath: string): Promise<TFile> {
    const normalized = normalizePath(newPath);
    if (await this.adapter.exists(normalized)) throw new Error("Destination file already exists!");
    await this.adapter.copy(file.path, normalized);
    return this.mustBeFile(normalized);
  }

  async delete(file: TAbstractFile, _force = false): Promise<void> {
    if (file instanceof TFolder) {
      await this.adapter.rmdir(file.path, true);
    } else {
      await this.adapter.remove(file.path);
    }
  }

  /** Move a file or folder into the vault's `.trash` folder, Obsidian's
   *  "Move to Obsidian trash" behaviour. A name already taken there gets a
   *  numeric suffix. There is no system trash inside a container, so
   *  `system` is accepted and ignored. */
  async trash(file: TAbstractFile, _system: boolean): Promise<void> {
    const trashDir = ".trash";
    const base = file instanceof TFile ? file.basename : file.name;
    const extension = file instanceof TFile && file.extension ? "." + file.extension : "";
    let target = `${trashDir}/${base}${extension}`;
    for (let n = 1; await this.adapter.exists(target); n++) {
      target = `${trashDir}/${base} ${n}${extension}`;
    }
    await this.adapter.rename(file.path, target);
  }

  /** Move a file or folder, keeping its index object: the same `TFile` now
   *  carries the new path, and `rename` is announced with the old one. */
  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const destination = normalizePath(newPath);
    const oldPath = file.path;
    if (destination === oldPath) return;
    if (await this.adapter.exists(destination)) {
      // A case-only rename on a case-insensitive disk names the same entry.
      if (destination.toLowerCase() !== oldPath.toLowerCase()) {
        throw new Error("Destination file already exists!");
      }
    }
    const from = this.adapter.getFullPath(oldPath);
    const to = this.adapter.getFullPath(destination);
    await this.serialized(async () => {
      await fs.promises.mkdir(posix.dirname(to), { recursive: true });
      await this.ensureFolders(posix.dirname(destination), true);
      await fs.promises.rename(from, to);
      const moved: Array<[TAbstractFile, string]> = [];
      this.moveEntry(file, destination, moved);
      for (const [entry, previous] of moved) {
        if (entry instanceof TFile) this.metadataCache.move(previous, entry.path);
      }
      this.metadataCache.filesChanged();
      for (const [entry, previous] of moved) this.trigger("rename", entry, previous);
    });
    // A folder that was hidden from the index (a dot-name) and is now visible,
    // or the reverse, is settled by a sync of both ends.
    await this.sync(oldPath);
    await this.sync(destination);
  }

  /** Bring the index entry for `path` in line with the disk, announcing what
   *  changed. Safe to call for paths that did not change. */
  async sync(path: string): Promise<void> {
    await this.serialized(() => this.syncUnlocked(normalizePath(path)));
  }

  /** Re-read the whole folder and settle every difference. The watcher can
   *  miss events (on some network and container mounts it sees none), so
   *  this runs on a timer as well as at startup. */
  async reconcile(): Promise<void> {
    await this.serialized(async () => {
      const seen = new Set<string>(["/"]);
      await this.reconcileFolder("/", seen, new Set());
      const gone = [...this.fileMap.keys()].filter((path) => !seen.has(path));
      let structural = false;
      // Deepest first, so a folder's children are announced before it.
      gone.sort((a, b) => b.length - a.length);
      for (const path of gone) {
        const entry = this.fileMap.get(path);
        if (entry) {
          this.removeEntry(entry);
          structural = true;
        }
      }
      if (structural) this.metadataCache.filesChanged();
    });
  }

  isHidden(path: string): boolean {
    return path.split("/").some((segment) => segment.startsWith("."));
  }

  private async reconcileFolder(path: string, seen: Set<string>, visited: Set<string>): Promise<void> {
    const full = this.adapter.getFullPath(path);
    let real: string;
    try {
      real = await fs.promises.realpath(full);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let listing: { files: string[]; folders: string[] };
    try {
      listing = await this.adapter.list(path);
    } catch {
      return;
    }
    for (const child of [...listing.folders, ...listing.files]) {
      if (this.isHidden(child)) continue;
      seen.add(child);
      await this.syncUnlocked(child, false);
      if (listing.folders.includes(child)) await this.reconcileFolder(child, seen, visited);
    }
  }

  private async syncUnlocked(path: string, recurse = true): Promise<void> {
    if (path === "/" || this.isHidden(path)) return;
    let stat: Stat | null;
    try {
      stat = toStat(await fs.promises.stat(this.adapter.getFullPath(path)));
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      stat = null;
    }
    const existing = this.fileMap.get(path);

    if (!stat) {
      if (existing) {
        this.removeEntry(existing);
        this.metadataCache.filesChanged();
      }
      return;
    }

    if (existing && (stat.type === "folder") !== (existing instanceof TFolder)) {
      this.removeEntry(existing);
    }
    const current = this.fileMap.get(path);

    if (stat.type === "folder") {
      if (!current) {
        await this.ensureFolders(path, true);
        if (recurse) {
          const folder = this.fileMap.get(path);
          if (folder instanceof TFolder) await this.scanFolder(folder, true, new Set());
        }
        this.metadataCache.filesChanged();
      }
      return;
    }

    if (!current) {
      await this.ensureFolders(posix.dirname(path), true);
      const file = new TFile(path, { ctime: stat.ctime, mtime: stat.mtime, size: stat.size });
      this.attach(file);
      this.metadataCache.filesChanged();
      this.trigger("create", file);
      await this.indexContent(file, true);
      return;
    }

    if (!(current instanceof TFile)) return;
    const file = current;
    if (file.stat.mtime === stat.mtime && file.stat.size === stat.size && this.cacheIsFresh(file)) {
      return;
    }
    file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
    this.trigger("modify", file);
    await this.indexContent(file, true);
  }

  private cacheIsFresh(file: TFile): boolean {
    return file.extension !== "md" || this.metadataCache.isFresh(file);
  }

  private async indexContent(file: TFile, announce: boolean): Promise<void> {
    if (file.extension !== "md") return;
    let content: string;
    try {
      content = await this.adapter.read(file.path);
    } catch {
      return;
    }
    this.metadataCache.update(file, content, announce);
  }

  private async scanFolder(folder: TFolder, announce: boolean, visited: Set<string>): Promise<void> {
    const full = this.adapter.getFullPath(folder.path);
    let real: string;
    try {
      real = await fs.promises.realpath(full);
    } catch {
      return;
    }
    // A symlink loop would otherwise be walked forever.
    if (visited.has(real)) return;
    visited.add(real);

    let listing: { files: string[]; folders: string[] };
    try {
      listing = await this.adapter.list(folder.path);
    } catch (error) {
      console.warn(`[REST API] Could not list ${folder.path}:`, error);
      return;
    }
    for (const path of listing.folders) {
      if (this.isHidden(path) || this.fileMap.has(path)) continue;
      const child = new TFolder(path);
      this.attach(child);
      if (announce) this.trigger("create", child);
      await this.scanFolder(child, announce, visited);
    }
    for (const path of listing.files) {
      if (this.isHidden(path) || this.fileMap.has(path)) continue;
      let stat: Stat;
      try {
        stat = toStat(await fs.promises.stat(this.adapter.getFullPath(path)));
      } catch {
        continue;
      }
      const file = new TFile(path, { ctime: stat.ctime, mtime: stat.mtime, size: stat.size });
      this.attach(file);
      if (announce) this.trigger("create", file);
      await this.indexContent(file, announce);
    }
  }

  /** Make sure every folder on the way to `path` is indexed. */
  private async ensureFolders(path: string, announce: boolean): Promise<void> {
    const normalized = normalizePath(path === "." ? "/" : path);
    if (normalized === "/" || this.fileMap.has(normalized)) return;
    await this.ensureFolders(posix.dirname(normalized), announce);
    if (this.isHidden(normalized)) return;
    const folder = new TFolder(normalized);
    this.attach(folder);
    if (announce) this.trigger("create", folder);
  }

  private attach(entry: TAbstractFile): void {
    const parentPath = posix.dirname(entry.path);
    const parent = this.fileMap.get(parentPath === "." ? "/" : parentPath);
    if (parent instanceof TFolder) {
      entry.parent = parent;
      parent.children.push(entry);
    }
    this.fileMap.set(entry.path, entry);
  }

  private detach(entry: TAbstractFile): void {
    if (entry.parent) {
      const siblings = entry.parent.children;
      const index = siblings.indexOf(entry);
      if (index !== -1) siblings.splice(index, 1);
    }
    entry.parent = null;
    this.fileMap.delete(entry.path);
  }

  /** Drop an entry and everything beneath it, announcing each deletion. */
  private removeEntry(entry: TAbstractFile): void {
    if (entry instanceof TFolder) {
      for (const child of [...entry.children]) this.removeEntry(child);
    }
    this.detach(entry);
    if (entry instanceof TFile) this.metadataCache.remove(entry);
    this.trigger("delete", entry);
  }

  private moveEntry(entry: TAbstractFile, newPath: string, moved: Array<[TAbstractFile, string]>): void {
    const oldPath = entry.path;
    this.detach(entry);
    entry.setPath(newPath);
    if (this.isHidden(newPath)) {
      // Moved out of sight (into `.trash`, say): gone from the index.
      if (entry instanceof TFile) this.metadataCache.remove(entry);
      if (entry instanceof TFolder) {
        for (const child of [...entry.children]) this.removeEntry(child);
      }
      this.trigger("delete", entry);
      return;
    }
    this.attach(entry);
    moved.push([entry, oldPath]);
    if (entry instanceof TFolder) {
      for (const child of [...entry.children]) {
        this.fileMap.delete(child.path);
        const childPath = `${newPath}/${child.name}`;
        // Re-attached under the moved folder by the recursive call.
        const index = entry.children.indexOf(child);
        if (index !== -1) entry.children.splice(index, 1);
        child.parent = null;
        this.moveChild(child, childPath, entry, moved);
      }
    }
  }

  private moveChild(
    entry: TAbstractFile,
    newPath: string,
    parent: TFolder,
    moved: Array<[TAbstractFile, string]>,
  ): void {
    const oldPath = entry.path;
    entry.setPath(newPath);
    entry.parent = parent;
    parent.children.push(entry);
    this.fileMap.set(newPath, entry);
    moved.push([entry, oldPath]);
    if (entry instanceof TFolder) {
      for (const child of [...entry.children]) {
        this.fileMap.delete(child.path);
        const index = entry.children.indexOf(child);
        if (index !== -1) entry.children.splice(index, 1);
        this.moveChild(child, `${newPath}/${child.name}`, entry, moved);
      }
    }
  }

  private mustBeFile(path: string): TFile {
    const file = this.getFileByPath(path);
    if (!file) throw new Error(`File was written but is not indexed: ${path}`);
    return file;
  }

  /** Run index changes one at a time, in order, so two writes to the same
   *  path cannot both announce a `create`. */
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      (): void => undefined,
      (): void => undefined,
    );
    return run;
  }
}
