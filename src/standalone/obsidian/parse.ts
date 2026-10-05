/** Parse a markdown note into the shape of Obsidian's `CachedMetadata`.
 *
 *  Obsidian builds this cache with its own parser, which runs inside the app.
 *  This is an approximation of it that covers what the API reads: frontmatter,
 *  tags, headings, block ids, wikilinks, embeds, markdown links, and links in
 *  frontmatter values. Code blocks, inline code, math blocks and `%%` comments
 *  are skipped, as Obsidian skips them. Each link also carries its character
 *  offsets in the source, which is what lets a rename rewrite it in place. */

import { parse as parseYaml } from "yaml";

export interface Loc {
  line: number;
  col: number;
  offset: number;
}

export interface Pos {
  start: Loc;
  end: Loc;
}

export interface TagCache {
  tag: string;
  position: Pos;
}

export interface HeadingCache {
  heading: string;
  level: number;
  position: Pos;
}

export interface LinkCache {
  link: string;
  original: string;
  displayText?: string;
  position: Pos;
}

export interface FrontmatterLinkCache {
  key: string;
  link: string;
  original: string;
  displayText?: string;
}

export interface BlockCache {
  id: string;
  position: Pos;
}

export interface CachedMetadata {
  frontmatter?: Record<string, unknown>;
  frontmatterPosition?: Pos;
  frontmatterLinks?: FrontmatterLinkCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  links?: LinkCache[];
  embeds?: LinkCache[];
  blocks?: Record<string, BlockCache>;
}

/** One link in a note, with enough detail to resolve it and to rewrite it. */
export interface LinkReference {
  /** wikilink: `[[x]]`; markdown: `[t](x)`; either may be an embed (`!`). */
  syntax: "wikilink" | "markdown";
  embed: boolean;
  /** Whether the link sits in a frontmatter value. */
  inFrontmatter: boolean;
  /** The path part, decoded, without the `#subpath`. Empty for a link to a
   *  heading or block in the same note. */
  linkpath: string;
  /** `#heading` or `#^block`, including the `#`, or "". */
  subpath: string;
  /** The `|alias` of a wikilink or the text of a markdown link, if any. */
  alias?: string;
  /** The whole link as written, e.g. `![[a#b|c]]`. */
  original: string;
  /** A markdown link's destination exactly as written, `<...>` included. */
  destination?: string;
  /** Offsets of `original` in the note. */
  start: number;
  end: number;
}

export interface ParsedNote {
  cache: CachedMetadata;
  references: LinkReference[];
}

const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /(!?)\[((?:\\.|[^\]\\\n])*)\]\(\s*(<[^>\n]*>|(?:\\.|[^()\s\\]|\((?:\\.|[^()\s\\])*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
/** Characters Obsidian does not allow in a tag. */
const TAG = /(^|[\s(])#([^\s#!"$%&'()*+,.:;<=>?@^`{|}~[\]\\\u3000-\u303f]+)/gu;
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function parseNote(text: string): ParsedNote {
  const lineStarts = computeLineStarts(text);
  const loc = (offset: number): Loc => locate(lineStarts, offset);
  const pos = (start: number, end: number): Pos => ({ start: loc(start), end: loc(end) });

  const cache: CachedMetadata = {};
  const references: LinkReference[] = [];
  const tags: TagCache[] = [];
  const headings: HeadingCache[] = [];
  const links: LinkCache[] = [];
  const embeds: LinkCache[] = [];
  const blocks: Record<string, BlockCache> = {};

  const frontmatter = readFrontmatter(text);
  let bodyStart = 0;
  if (frontmatter) {
    bodyStart = frontmatter.end;
    cache.frontmatterPosition = pos(0, frontmatter.end);
    if (frontmatter.data) {
      cache.frontmatter = frontmatter.data;
      const fmLinks = frontmatterLinks(frontmatter.data);
      if (fmLinks.length > 0) cache.frontmatterLinks = fmLinks;
    }
    // Frontmatter links are found in the raw text too, so a rename can rewrite
    // them where they stand.
    const raw = text.slice(0, frontmatter.end);
    for (const match of raw.matchAll(WIKILINK)) {
      const reference = wikilinkReference(match, match.index ?? 0, true);
      if (reference) references.push(reference);
    }
  }

  const masked = maskIgnoredRegions(text, bodyStart);

  for (const match of masked.matchAll(WIKILINK)) {
    const start = match.index ?? 0;
    const reference = wikilinkReference(match, start, false);
    if (!reference) continue;
    references.push(reference);
    const entry: LinkCache = {
      link: reference.linkpath + reference.subpath,
      original: reference.original,
      displayText: reference.alias ?? reference.linkpath + reference.subpath,
      position: pos(reference.start, reference.end),
    };
    (reference.embed ? embeds : links).push(entry);
  }

  for (const match of masked.matchAll(MARKDOWN_LINK)) {
    const start = match.index ?? 0;
    // Outside the blanked regions the masked copy is the text itself.
    const original = match[0];
    const reference = markdownReference(original, match[1] === "!", match[2], match[3], start);
    if (!reference) continue;
    references.push(reference);
    const entry: LinkCache = {
      link: reference.linkpath + reference.subpath,
      original,
      displayText: reference.alias,
      position: pos(reference.start, reference.end),
    };
    (reference.embed ? embeds : links).push(entry);
  }

  // Tags, headings and block ids are line-oriented. Links are masked out
  // first so `[[note#heading]]` is not read as a tag.
  const forTags = masked.replace(WIKILINK, (m) => " ".repeat(m.length)).replace(MARKDOWN_LINK, (m) => " ".repeat(m.length));
  for (const match of forTags.matchAll(TAG)) {
    const name = match[2];
    if (/^[0-9/]+$/.test(name)) continue;
    const start = (match.index ?? 0) + match[1].length;
    tags.push({ tag: "#" + name, position: pos(start, start + name.length + 1) });
  }

  for (let line = 0; line < lineStarts.length; line++) {
    const lineStart = lineStarts[line];
    if (lineStart < bodyStart) continue;
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
    const maskedLine = masked.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (maskedLine.trim() === "") continue;
    const heading = HEADING.exec(maskedLine);
    if (heading) {
      headings.push({
        heading: text.slice(lineStart, lineEnd).replace(/\r$/, "").replace(HEADING, "$2"),
        level: heading[1].length,
        position: pos(lineStart, lineStart + maskedLine.length),
      });
    }
    const block = BLOCK_ID.exec(maskedLine);
    if (block) {
      blocks[block[1].toLowerCase()] = {
        id: block[1],
        position: pos(lineStart, lineStart + maskedLine.length),
      };
    }
  }

  if (tags.length > 0) cache.tags = tags;
  if (headings.length > 0) cache.headings = headings;
  if (links.length > 0) cache.links = links;
  if (embeds.length > 0) cache.embeds = embeds;
  if (Object.keys(blocks).length > 0) cache.blocks = blocks;
  references.sort((a, b) => a.start - b.start);
  return { cache, references };
}

/** The frontmatter block: its parsed data (undefined when the YAML does not
 *  parse to a mapping) and the offset just past its closing `---` line. */
function readFrontmatter(text: string): { data?: Record<string, unknown>; end: number } | null {
  const opening = /^---[ \t]*\r?\n/.exec(text);
  if (!opening) return null;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;
  const rest = text.slice(opening[0].length);
  // The closing fence may directly follow the opening one (empty frontmatter).
  const match = closing.exec(rest);
  if (!match || match.index === undefined) return null;
  const yamlText = rest.slice(0, match.index);
  const end = opening[0].length + match.index + match[0].length;
  try {
    const data: unknown = parseYaml(yamlText, { uniqueKeys: false });
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { data: data as Record<string, unknown>, end };
    }
    return { end };
  } catch {
    return { end };
  }
}

function frontmatterLinks(data: Record<string, unknown>): FrontmatterLinkCache[] {
  const found: FrontmatterLinkCache[] = [];
  const visit = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(WIKILINK)) {
        const reference = wikilinkReference(match, 0, true);
        if (!reference || reference.embed) continue;
        found.push({
          key,
          link: reference.linkpath + reference.subpath,
          original: reference.original,
          displayText: reference.alias ?? reference.linkpath + reference.subpath,
        });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${key}.${index}`));
    }
  };
  for (const [key, value] of Object.entries(data)) visit(value, key);
  return found;
}

function wikilinkReference(
  match: ArrayLike<string>,
  start: number,
  inFrontmatter: boolean,
): LinkReference | null {
  const original = match[0];
  const embed = match[1] === "!";
  // A `\|` (written inside tables) separates the alias like a bare `|`.
  const inner = match[2].replace(/\\\|/g, "|");
  const pipe = inner.indexOf("|");
  const target = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1);
  const hash = target.indexOf("#");
  const linkpath = (hash === -1 ? target : target.slice(0, hash)).trim();
  const subpath = hash === -1 ? "" : target.slice(hash).trim();
  if (linkpath === "" && subpath === "") return null;
  return {
    syntax: "wikilink",
    embed,
    inFrontmatter,
    linkpath,
    subpath,
    alias,
    original,
    start,
    end: start + original.length,
  };
}

function markdownReference(
  original: string,
  embed: boolean,
  text: string,
  destination: string,
  start: number,
): LinkReference | null {
  let url = destination.trim();
  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1);
  if (url === "" || URL_SCHEME.test(url) || url.startsWith("//")) return null;
  let decoded = url;
  try {
    decoded = decodeURI(url);
  } catch {
    // A malformed escape is kept as written.
  }
  const hash = decoded.indexOf("#");
  const linkpath = hash === -1 ? decoded : decoded.slice(0, hash);
  const subpath = hash === -1 ? "" : decoded.slice(hash);
  if (linkpath === "" && subpath === "") return null;
  return {
    syntax: "markdown",
    embed,
    inFrontmatter: false,
    linkpath,
    subpath,
    alias: text,
    destination,
    original,
    start,
    end: start + original.length,
  };
}

/** A copy of `text` with every region Obsidian does not parse for links or
 *  tags blanked out with spaces, so offsets in the copy are offsets in the
 *  original: the frontmatter, fenced code blocks, `$$` math blocks, `%%`
 *  comments, HTML comments and inline code spans. Newlines are kept so line
 *  numbers still line up. */
function maskIgnoredRegions(text: string, bodyStart: number): string {
  const chars = text.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < chars.length; i++) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  };
  blank(0, bodyStart);

  // Fenced code and math blocks, line by line.
  const lineStarts = computeLineStarts(text);
  let fence: { char: string; length: number; start: number } | null = null;
  let math: number | null = null;
  for (let line = 0; line < lineStarts.length; line++) {
    const start = lineStarts[line];
    if (start < bodyStart) continue;
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
    const content = text.slice(start, end).replace(/\r?\n$/, "");
    const stripped = content.replace(/^(?:[ \t]*>)*[ \t]*/, "");
    if (fence) {
      const close = new RegExp(`^\\${fence.char}{${fence.length},}[ \\t]*$`);
      if (close.test(stripped)) {
        blank(fence.start, end);
        fence = null;
      }
      continue;
    }
    if (math !== null) {
      if (/\$\$[ \t]*$/.test(stripped)) {
        blank(math, end);
        math = null;
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(stripped);
    if (open) {
      fence = { char: open[1][0], length: open[1].length, start };
      continue;
    }
    if (/^\$\$/.test(stripped) && !/^\$\$.*\$\$[ \t]*$/.test(stripped.trim())) {
      math = start;
      continue;
    }
  }
  if (fence) blank(fence.start, text.length);
  if (math !== null) blank(math, text.length);

  let masked = chars.join("");
  const blankMatches = (pattern: RegExp): void => {
    masked = masked.replace(pattern, (m) => m.replace(/[^\n]/g, " "));
  };
  blankMatches(/%%[\s\S]*?(?:%%|$)/g);
  blankMatches(/<!--[\s\S]*?(?:-->|$)/g);
  blankMatches(/(`+)(?!`)[^\n]*?[^`\n]?\1(?!`)/g);
  blankMatches(/\$\$[^\n]*?\$\$/g);
  return masked;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function locate(lineStarts: number[], offset: number): Loc {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low, col: offset - lineStarts[low], offset };
}
