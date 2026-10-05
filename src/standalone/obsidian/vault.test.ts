import fs from "fs";
import os from "os";
import path from "path";
import { App, getAllTags, TFile, TFolder } from "./index";
import type { FileManagerOptions } from "./fileManager";

const defaults: FileManagerOptions = {
  updateLinks: true,
  newLinkFormat: "shortest",
  trashOption: "local",
};

let root: string;

function write(relative: string, content: string): void {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

async function makeApp(options: Partial<FileManagerOptions> = {}): Promise<App> {
  const app = new App({ vaultPath: root, configDir: ".obsidian", ...defaults, ...options });
  await app.vault.load();
  return app;
}

function record(app: App): string[] {
  const seen: string[] = [];
  for (const event of ["create", "modify", "delete", "rename"]) {
    app.vault.on(event, (file: unknown, oldPath?: unknown) => {
      if (!(file instanceof TFile) && !(file instanceof TFolder)) throw new Error("not a vault entry");
      seen.push(typeof oldPath === "string" ? `${event} ${oldPath} -> ${file.path}` : `${event} ${file.path}`);
    });
  }
  return seen;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vault-")));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("loading", () => {
  test("indexes files and folders, leaving out dot-names", async () => {
    write("a.md", "A");
    write("folder/b.md", "B");
    write("folder/image.png", "x");
    write(".obsidian/app.json", "{}");
    write(".hidden/c.md", "C");
    write("folder/.secret.md", "S");
    const app = await makeApp();
    expect(app.vault.getFiles().map((f) => f.path).sort()).toEqual(["a.md", "folder/b.md", "folder/image.png"]);
    expect(app.vault.getMarkdownFiles().map((f) => f.path).sort()).toEqual(["a.md", "folder/b.md"]);
    expect(app.vault.getAbstractFileByPath("folder")).toBeInstanceOf(TFolder);
    expect(app.vault.getFolderByPath("folder")?.children.map((c) => c.name).sort()).toEqual([
      "b.md",
      "image.png",
    ]);
  });

  test("fills the metadata cache and the link graph", async () => {
    write("a.md", "---\ntags: [x]\n---\n[[b]] [[missing]] #y");
    write("sub/b.md", "back to [[a]]");
    const app = await makeApp();
    const a = app.vault.getFileByPath("a.md");
    expect(getAllTags(app.metadataCache.getFileCache(a))).toEqual(["#x", "#y"]);
    expect(app.metadataCache.resolvedLinks["a.md"]).toEqual({ "sub/b.md": 1 });
    expect(app.metadataCache.unresolvedLinks["a.md"]).toEqual({ missing: 1 });
    expect(app.metadataCache.resolvedLinks["sub/b.md"]).toEqual({ "a.md": 1 });
  });

  test("does not follow a symlink loop forever", async () => {
    write("a.md", "A");
    fs.symlinkSync(root, path.join(root, "loop"));
    const app = await makeApp();
    expect(app.vault.getFileByPath("a.md")).not.toBeNull();
  });
});

describe("writes", () => {
  test("create and modify announce the change and update the cache before returning", async () => {
    const app = await makeApp();
    const seen = record(app);
    const changed: string[] = [];
    app.metadataCache.on("changed", (file: unknown) => {
      if (file instanceof TFile) changed.push(file.path);
    });

    const file = await app.vault.create("notes/new.md", "#first");
    expect(seen).toEqual(["create notes", "create notes/new.md"]);
    expect(app.metadataCache.getFileCache(file)?.tags?.[0].tag).toBe("#first");

    await app.vault.modify(file, "#second");
    expect(seen).toContain("modify notes/new.md");
    expect(app.metadataCache.getFileCache(file)?.tags?.[0].tag).toBe("#second");
    expect(changed).toEqual(["notes/new.md", "notes/new.md"]);
  });

  test("create refuses an existing file and createFolder an existing folder", async () => {
    write("a.md", "A");
    const app = await makeApp();
    await expect(app.vault.create("a.md", "again")).rejects.toThrow("File already exists.");
    await expect(app.vault.createFolder(".")).rejects.toThrow("Folder already exists.");
  });

  test("an adapter write indexes a new file", async () => {
    const app = await makeApp();
    await app.vault.adapter.writeBinary("bin/data.bin", new Uint8Array([1, 2, 3]).buffer);
    const file = app.vault.getFileByPath("bin/data.bin");
    expect(file?.stat.size).toBe(3);
  });

  test("a link starts resolving when its target is created", async () => {
    write("a.md", "[[later]]");
    const app = await makeApp();
    expect(app.metadataCache.unresolvedLinks["a.md"]).toEqual({ later: 1 });
    await app.vault.create("later.md", "");
    expect(app.metadataCache.resolvedLinks["a.md"]).toEqual({ "later.md": 1 });
  });

  test("copy creates an indexed file and refuses an existing destination", async () => {
    write("a.md", "#t");
    const app = await makeApp();
    const copy = await app.vault.copy(app.vault.getFileByPath("a.md"), "b.md");
    expect(copy.path).toBe("b.md");
    expect(app.metadataCache.getFileCache(copy)?.tags?.[0].tag).toBe("#t");
    await expect(app.vault.copy(copy, "a.md")).rejects.toThrow();
  });
});

describe("rename", () => {
  test("keeps the same object, moves its cache, and announces the old path", async () => {
    write("a.md", "#tag");
    const app = await makeApp();
    const seen = record(app);
    const file = app.vault.getFileByPath("a.md");
    await app.fileManager.renameFile(file, "deep/new.md");
    expect(file.path).toBe("deep/new.md");
    expect(file.basename).toBe("new");
    expect(app.vault.getFileByPath("deep/new.md")).toBe(file);
    expect(app.vault.getAbstractFileByPath("a.md")).toBeNull();
    expect(app.metadataCache.getFileCache(file)?.tags?.[0].tag).toBe("#tag");
    expect(seen).toEqual(["create deep", "rename a.md -> deep/new.md"]);
    expect(read("deep/new.md")).toBe("#tag");
  });

  test("rewrites wikilinks, embeds and markdown links that pointed at the file", async () => {
    write("target.md", "# Head\n");
    write(
      "source.md",
      "[[target]] [[target#Head|alias]] ![[target]] [t](target.md#Head \"title\") [[other]] `[[target]]`",
    );
    write("other.md", "");
    const app = await makeApp();
    await app.fileManager.renameFile(app.vault.getFileByPath("target.md"), "moved/Renamed Note.md");
    expect(read("source.md")).toBe(
      "[[Renamed Note]] [[Renamed Note#Head|alias]] ![[Renamed Note]] [t](Renamed%20Note.md#Head \"title\") [[other]] `[[target]]`",
    );
    expect(app.metadataCache.resolvedLinks["source.md"]).toEqual({
      "moved/Renamed Note.md": 4,
      "other.md": 1,
    });
  });

  test("uses the full path when the new name is not unique", async () => {
    write("a.md", "[[target]]");
    write("target.md", "");
    write("elsewhere/dup.md", "");
    const app = await makeApp();
    await app.fileManager.renameFile(app.vault.getFileByPath("target.md"), "x/dup.md");
    expect(read("a.md")).toBe("[[x/dup]]");
  });

  test("rewrites links in frontmatter", async () => {
    write("a.md", '---\nup: "[[target]]"\n---\nbody');
    write("target.md", "");
    const app = await makeApp();
    await app.fileManager.renameFile(app.vault.getFileByPath("target.md"), "parent.md");
    expect(read("a.md")).toBe('---\nup: "[[parent]]"\n---\nbody');
  });

  test("rewrites links to every file inside a moved folder", async () => {
    write("a.md", "[[folder/one]] [[two]]");
    write("folder/one.md", "");
    write("folder/two.md", "");
    write("other/two.md", "");
    const app = await makeApp({ newLinkFormat: "absolute" });
    // `two` resolves to other/two.md (shorter path), so only `folder/one` moves.
    await app.fileManager.renameFile(app.vault.getAbstractFileByPath("folder"), "renamed");
    expect(app.vault.getFileByPath("renamed/one.md")).not.toBeNull();
    expect(app.vault.getAbstractFileByPath("folder/one.md")).toBeNull();
    expect(read("a.md")).toBe("[[renamed/one]] [[two]]");
  });

  test("leaves links alone when link updating is off", async () => {
    write("a.md", "[[target]]");
    write("target.md", "");
    const app = await makeApp({ updateLinks: false });
    await app.fileManager.renameFile(app.vault.getFileByPath("target.md"), "new.md");
    expect(read("a.md")).toBe("[[target]]");
    expect(app.metadataCache.unresolvedLinks["a.md"]).toEqual({ target: 1 });
  });
});

describe("deletion", () => {
  test("trashFile moves into .trash, numbering a name already taken", async () => {
    write("a.md", "one");
    write(".trash/a.md", "old");
    const app = await makeApp();
    const seen = record(app);
    await app.fileManager.trashFile(app.vault.getFileByPath("a.md"));
    expect(fs.existsSync(path.join(root, "a.md"))).toBe(false);
    expect(read(".trash/a 1.md")).toBe("one");
    expect(seen).toEqual(["delete a.md"]);
    expect(app.metadataCache.resolvedLinks["a.md"]).toBeUndefined();
  });

  test("trashFile deletes outright when the trash option is none", async () => {
    write("a.md", "one");
    const app = await makeApp({ trashOption: "none" });
    await app.fileManager.trashFile(app.vault.getFileByPath("a.md"));
    expect(fs.existsSync(path.join(root, "a.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".trash"))).toBe(false);
  });

  test("deleting a folder announces its children first", async () => {
    write("f/a.md", "");
    write("f/g/b.md", "");
    const app = await makeApp();
    const seen = record(app);
    await app.vault.delete(app.vault.getAbstractFileByPath("f"), true);
    expect([...seen].sort()).toEqual(["delete f", "delete f/a.md", "delete f/g", "delete f/g/b.md"]);
    expect(seen.indexOf("delete f/g/b.md")).toBeLessThan(seen.indexOf("delete f/g"));
    expect(seen[seen.length - 1]).toBe("delete f");
  });
});

describe("changes made outside the server", () => {
  test("sync picks up a new, changed and deleted file", async () => {
    write("a.md", "#one");
    const app = await makeApp();
    const seen = record(app);

    write("b.md", "new");
    await app.vault.sync("b.md");
    // A different size, so the change is seen even within the same millisecond.
    write("a.md", "#two two");
    await app.vault.sync("a.md");
    fs.rmSync(path.join(root, "b.md"));
    await app.vault.sync("b.md");

    expect(seen).toEqual(["create b.md", "modify a.md", "delete b.md"]);
    const a = app.vault.getFileByPath("a.md");
    expect(app.metadataCache.getFileCache(a)?.tags?.[0].tag).toBe("#two");
  });

  test("sync of an unchanged file announces nothing", async () => {
    write("a.md", "A");
    const app = await makeApp();
    const seen = record(app);
    await app.vault.sync("a.md");
    expect(seen).toEqual([]);
  });

  test("reconcile finds everything that changed while nobody was looking", async () => {
    write("keep.md", "");
    write("gone/x.md", "");
    const app = await makeApp();
    fs.rmSync(path.join(root, "gone"), { recursive: true });
    write("arrived/y.md", "[[keep]]");
    await app.vault.reconcile();
    expect(app.vault.getFiles().map((f) => f.path).sort()).toEqual(["arrived/y.md", "keep.md"]);
    expect(app.vault.getAbstractFileByPath("gone")).toBeNull();
    expect(app.metadataCache.resolvedLinks["arrived/y.md"]).toEqual({ "keep.md": 1 });
  });
});

describe("link resolution", () => {
  test("prefers a file in the source's folder, then the shortest path", async () => {
    write("a/note.md", "");
    write("b/c/note.md", "");
    write("b/source.md", "[[note]]");
    write("a/source.md", "[[note]]");
    const app = await makeApp();
    expect(app.metadataCache.getFirstLinkpathDest("note", "a/source.md")?.path).toBe("a/note.md");
    expect(app.metadataCache.getFirstLinkpathDest("note", "b/source.md")?.path).toBe("a/note.md");
    expect(app.metadataCache.getFirstLinkpathDest("c/note", "b/source.md")?.path).toBe("b/c/note.md");
  });

  test("resolves relative paths and ignores case", async () => {
    write("dir/Note.md", "");
    write("dir/sub/s.md", "");
    const app = await makeApp();
    expect(app.metadataCache.getFirstLinkpathDest("../Note.md", "dir/sub/s.md")?.path).toBe("dir/Note.md");
    expect(app.metadataCache.getFirstLinkpathDest("NOTE", "x.md")?.path).toBe("dir/Note.md");
    expect(app.metadataCache.getFirstLinkpathDest("../../../etc/passwd", "dir/sub/s.md")).toBeNull();
  });
});

describe("adapter", () => {
  test("refuses a path that escapes the vault", async () => {
    const app = await makeApp();
    expect(() => app.vault.adapter.getFullPath("../outside.md")).toThrow("escapes");
    await expect(app.vault.adapter.read("../../etc/passwd")).rejects.toThrow("escapes");
  });

  test("stat reports files and folders, and null for a miss", async () => {
    write("f/a.md", "abc");
    const app = await makeApp();
    expect(await app.vault.adapter.stat("f/a.md")).toMatchObject({ type: "file", size: 3 });
    expect(await app.vault.adapter.stat("f")).toMatchObject({ type: "folder" });
    expect(await app.vault.adapter.stat("nope.md")).toBeNull();
  });
});
