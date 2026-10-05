/** A stand-in for Obsidian's `MarkdownRenderer`, used for `Accept: text/html`.
 *
 *  Obsidian renders through its own pipeline, with plugins, themes and live
 *  embeds. This renders CommonMark plus GFM with `marked`, turns wikilinks
 *  into the same `internal-link` anchors Obsidian emits, turns embeds into
 *  images or `internal-embed` spans, and leaves frontmatter out. */

import { Marked, type TokenizerAndRendererExtension, type Tokens } from "marked";

const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;

interface WikilinkToken extends Tokens.Generic {
  type: "wikilink";
  raw: string;
  embed: boolean;
  target: string;
  alias?: string;
}

const wikilink: TokenizerAndRendererExtension = {
  name: "wikilink",
  level: "inline",
  start(source: string) {
    const index = source.search(/!?\[\[/);
    return index === -1 ? undefined : index;
  },
  tokenizer(source: string): WikilinkToken | undefined {
    const match = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(source);
    if (!match) return undefined;
    const inner = match[2].replace(/\\\|/g, "|");
    const pipe = inner.indexOf("|");
    return {
      type: "wikilink",
      raw: match[0],
      embed: match[1] === "!",
      target: (pipe === -1 ? inner : inner.slice(0, pipe)).trim(),
      alias: pipe === -1 ? undefined : inner.slice(pipe + 1),
    };
  },
  renderer(token: Tokens.Generic): string {
    const { embed, target, alias } = token as WikilinkToken;
    const href = escapeAttribute(target);
    const label = escapeHtml(alias ?? target);
    if (embed) {
      const path = target.split("#")[0];
      if (IMAGE_EXTENSIONS.test(path)) {
        const width = alias && /^\d+(x\d+)?$/.test(alias) ? ` width="${alias.split("x")[0]}"` : "";
        return `<span class="internal-embed image-embed" src="${href}" alt="${label}"><img src="${escapeAttribute(path)}" alt="${label}"${width}></span>`;
      }
      return `<span class="internal-embed" src="${href}" alt="${label}"></span>`;
    }
    return `<a data-href="${href}" href="${href}" class="internal-link" target="_blank" rel="noopener nofollow">${label}</a>`;
  },
};

const renderer = new Marked({ gfm: true, async: false });
renderer.use({ extensions: [wikilink] });

export function renderMarkdown(markdown: string): string {
  return renderer.parse(stripFrontmatter(markdown), { async: false });
}

function stripFrontmatter(markdown: string): string {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

/** Matches Obsidian's `Component`: lifecycle hooks the renderer is handed. */
export class Component {
  load(): void {}
  unload(): void {}
}

/** The element the renderer writes into. The API only reads back its HTML. */
export interface RenderTarget {
  innerHTML: string;
}

export class MarkdownRenderer {
  static async render(
    _app: unknown,
    markdown: string,
    el: RenderTarget,
    _sourcePath: string,
    _component: Component,
  ): Promise<void> {
    // `el` is the plain object from ../globals, never a live DOM node: the
    // API sends this HTML to the client, as the plugin does with Obsidian's.
    // eslint-disable-next-line no-unsanitized/property
    el.innerHTML = renderMarkdown(markdown);
  }
}
