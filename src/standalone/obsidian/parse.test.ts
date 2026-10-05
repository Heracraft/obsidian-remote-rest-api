import { parseNote } from "./parse";

describe("parseNote", () => {
  test("reads frontmatter and records where it ends", () => {
    const { cache } = parseNote("---\ntitle: Hello\ntags: [a, b]\n---\nBody\n");
    expect(cache.frontmatter).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(cache.frontmatterPosition?.end.offset).toBe("---\ntitle: Hello\ntags: [a, b]\n---\n".length);
  });

  test("leaves frontmatter out when the YAML does not parse", () => {
    const { cache } = parseNote("---\n: : bad\n  - [\n---\nBody\n");
    expect(cache.frontmatter).toBeUndefined();
  });

  test("does not treat a horizontal rule later in the note as frontmatter", () => {
    const { cache } = parseNote("Intro\n---\nkey: value\n---\n");
    expect(cache.frontmatter).toBeUndefined();
  });

  test("finds inline tags, nested tags, and tags in headings", () => {
    const { cache } = parseNote("# Title #heading-tag\n\nText #one and #two/three.\n");
    expect(cache.tags?.map((tag) => tag.tag)).toEqual(["#heading-tag", "#one", "#two/three"]);
  });

  test("skips purely numeric tags, URL fragments, and headings", () => {
    const { cache } = parseNote("# Heading\n#123 http://x.com/#frag a#b\n");
    expect(cache.tags).toBeUndefined();
  });

  test("ignores tags and links inside code, math, and comments", () => {
    const text = [
      "```",
      "#code [[code-link]]",
      "```",
      "`#inline [[inline-link]]`",
      "%% #comment [[comment-link]] %%",
      "<!-- [[html-comment]] -->",
      "$$",
      "#math",
      "$$",
      "#real [[real-link]]",
    ].join("\n");
    const { cache } = parseNote(text);
    expect(cache.tags?.map((tag) => tag.tag)).toEqual(["#real"]);
    expect(cache.links?.map((link) => link.link)).toEqual(["real-link"]);
  });

  test("reads headings with their levels", () => {
    const { cache } = parseNote("# One\n\n### Three ###\nnot # a heading\n");
    expect(cache.headings?.map((h) => [h.level, h.heading])).toEqual([
      [1, "One"],
      [3, "Three"],
    ]);
  });

  test("reads wikilinks with subpaths and aliases, and embeds separately", () => {
    const { cache, references } = parseNote("[[a]] [[b#Head|Alias]] ![[pic.png]] [[c#^block]]\n");
    expect(cache.links?.map((link) => [link.link, link.displayText])).toEqual([
      ["a", "a"],
      ["b#Head", "Alias"],
      ["c#^block", "c#^block"],
    ]);
    expect(cache.embeds?.map((embed) => embed.link)).toEqual(["pic.png"]);
    expect(references.map((r) => [r.linkpath, r.subpath, r.alias, r.embed])).toEqual([
      ["a", "", undefined, false],
      ["b", "#Head", "Alias", false],
      ["pic.png", "", undefined, true],
      ["c", "#^block", undefined, false],
    ]);
  });

  test("records each link's offsets in the source", () => {
    const text = "x [[target|t]] y";
    const [reference] = parseNote(text).references;
    expect(text.slice(reference.start, reference.end)).toBe("[[target|t]]");
  });

  test("reads relative markdown links, decoding them, and skips external ones", () => {
    const { cache, references } = parseNote(
      "[A](My%20Note.md) [B](<other note.md#Sec>) [C](https://example.com) [D](mailto:x@y.z) ![img](pics/a.png)\n",
    );
    expect(cache.links?.map((link) => link.link)).toEqual(["My Note.md", "other note.md#Sec"]);
    expect(cache.embeds?.map((link) => link.link)).toEqual(["pics/a.png"]);
    expect(references[1].destination).toBe("<other note.md#Sec>");
  });

  test("does not read a wikilink to a heading as a tag", () => {
    const { cache } = parseNote("[[note#Heading]] [x](note.md#Heading)\n");
    expect(cache.tags).toBeUndefined();
  });

  test("reads links in frontmatter values, including lists", () => {
    const { cache, references } = parseNote('---\nup: "[[parent]]"\nrelated:\n  - "[[a]]"\n  - "[[b|B]]"\n---\n');
    expect(cache.frontmatterLinks).toEqual([
      { key: "up", link: "parent", original: "[[parent]]", displayText: "parent" },
      { key: "related.0", link: "a", original: "[[a]]", displayText: "a" },
      { key: "related.1", link: "b", original: "[[b|B]]", displayText: "B" },
    ]);
    expect(references.every((reference) => reference.inFrontmatter)).toBe(true);
  });

  test("reads block ids", () => {
    const { cache } = parseNote("A paragraph ^my-block\n");
    expect(cache.blocks?.["my-block"].id).toBe("my-block");
  });
});
