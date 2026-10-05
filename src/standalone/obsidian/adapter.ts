/** A stand-in for Obsidian's desktop `FileSystemAdapter`: raw file access
 *  under one directory on disk, addressed by vault-relative path.
 *
 *  Obsidian's adapter writes straight to disk and leaves its file index to
 *  notice the change through a watcher. This one tells the vault right away
 *  through `afterChange`, so an adapter write is visible in the index (and in
 *  the metadata cache) by the time the call returns. */

import fs from "fs";
import path from "path";
import { normalizePath } from "./files";

export interface Stat {
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
}

export interface DataWriteOptions {
  ctime?: number;
  mtime?: number;
}

export class DataAdapter {}

export class FileSystemAdapter extends DataAdapter {
  /** Called after a write, removal or rename with each vault path that changed. */
  afterChange: (vaultPath: string) => Promise<void> = async () => {};

  constructor(private readonly basePath: string) {
    super();
  }

  getBasePath(): string {
    return this.basePath;
  }

  getName(): string {
    return path.basename(this.basePath);
  }

  /** The absolute location of a vault path. The layers above refuse paths
   *  that escape the vault; this refuses them again so that a caller that
   *  skipped those checks still cannot leave the base directory. */
  getFullPath(vaultPath: string): string {
    const normalized = normalizePath(vaultPath);
    if (normalized === "/") return this.basePath;
    const full = path.resolve(this.basePath, normalized);
    if (full !== this.basePath && !full.startsWith(this.basePath + path.sep)) {
      throw new Error(`Path escapes the vault: ${vaultPath}`);
    }
    return full;
  }

  async exists(vaultPath: string): Promise<boolean> {
    try {
      await fs.promises.stat(this.getFullPath(vaultPath));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async stat(vaultPath: string): Promise<Stat | null> {
    try {
      const stat = await fs.promises.stat(this.getFullPath(vaultPath));
      return toStat(stat);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  async list(vaultPath: string): Promise<{ files: string[]; folders: string[] }> {
    const base = normalizePath(vaultPath);
    const entries = await fs.promises.readdir(this.getFullPath(base), { withFileTypes: true });
    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of entries) {
      const child = base === "/" ? entry.name : `${base}/${entry.name}`;
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          isDirectory = (await fs.promises.stat(this.getFullPath(child))).isDirectory();
        } catch {
          continue;
        }
      }
      (isDirectory ? folders : files).push(child);
    }
    return { files, folders };
  }

  async read(vaultPath: string): Promise<string> {
    return fs.promises.readFile(this.getFullPath(vaultPath), "utf8");
  }

  async readBinary(vaultPath: string): Promise<ArrayBuffer> {
    const buffer = await fs.promises.readFile(this.getFullPath(vaultPath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  async write(vaultPath: string, data: string, options?: DataWriteOptions): Promise<void> {
    await this.writeRaw(vaultPath, data, options);
  }

  async writeBinary(vaultPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    await this.writeRaw(vaultPath, Buffer.from(data), options);
  }

  async append(vaultPath: string, data: string): Promise<void> {
    const full = this.getFullPath(vaultPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.appendFile(full, data, "utf8");
    await this.afterChange(normalizePath(vaultPath));
  }

  async mkdir(vaultPath: string): Promise<void> {
    await fs.promises.mkdir(this.getFullPath(vaultPath), { recursive: true });
    await this.afterChange(normalizePath(vaultPath));
  }

  /** Remove a file. A folder is refused here, as with Obsidian's adapter;
   *  {@link rmdir} removes folders. */
  async remove(vaultPath: string): Promise<void> {
    const full = this.getFullPath(vaultPath);
    const stat = await fs.promises.lstat(full);
    if (stat.isDirectory()) {
      throw new Error(`Cannot remove a folder with remove(): ${vaultPath}`);
    }
    await fs.promises.unlink(full);
    await this.afterChange(normalizePath(vaultPath));
  }

  async rmdir(vaultPath: string, recursive: boolean): Promise<void> {
    const full = this.getFullPath(vaultPath);
    if (full === this.basePath) throw new Error("Refusing to remove the vault root.");
    if (recursive) {
      await fs.promises.rm(full, { recursive: true });
    } else {
      await fs.promises.rmdir(full);
    }
    await this.afterChange(normalizePath(vaultPath));
  }

  async rename(from: string, to: string): Promise<void> {
    const fullTo = this.getFullPath(to);
    await fs.promises.mkdir(path.dirname(fullTo), { recursive: true });
    await fs.promises.rename(this.getFullPath(from), fullTo);
    await this.afterChange(normalizePath(from));
    await this.afterChange(normalizePath(to));
  }

  async copy(from: string, to: string): Promise<void> {
    const fullTo = this.getFullPath(to);
    await fs.promises.mkdir(path.dirname(fullTo), { recursive: true });
    await fs.promises.copyFile(this.getFullPath(from), fullTo, fs.constants.COPYFILE_EXCL);
    await this.afterChange(normalizePath(to));
  }

  private async writeRaw(
    vaultPath: string,
    data: string | Buffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const full = this.getFullPath(vaultPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, data);
    if (options?.mtime !== undefined) {
      const mtime = new Date(options.mtime);
      await fs.promises.utimes(full, mtime, mtime);
    }
    await this.afterChange(normalizePath(vaultPath));
  }
}

export function toStat(stat: fs.Stats): Stat {
  return {
    type: stat.isDirectory() ? "folder" : "file",
    // birthtime is 0 on filesystems that do not record it; fall back to the
    // inode change time so ctime is never earlier than the epoch.
    ctime: Math.round(stat.birthtimeMs || stat.ctimeMs),
    mtime: Math.round(stat.mtimeMs),
    size: stat.isDirectory() ? 0 : stat.size,
  };
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}
