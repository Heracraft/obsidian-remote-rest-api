/** A stand-in for Obsidian's `prepareSimpleSearch`.
 *
 *  The query is split on whitespace and each word is matched
 *  case-insensitively. A text matches only when every word occurs in it; the
 *  result lists every occurrence of every word, in order. Obsidian does not
 *  document how it scores, so the score here is the number of occurrences,
 *  with a small bonus for an early first match: a note named after the query
 *  (the search sees the file name first) ranks above one that mentions it
 *  late. */

export interface SearchResult {
  score: number;
  matches: [number, number][];
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return (text: string): SearchResult | null => {
    if (words.length === 0) return null;
    const haystack = lowerCasePreservingLength(text);
    const matches: [number, number][] = [];
    for (const word of words) {
      let from = 0;
      let found = false;
      for (;;) {
        const at = haystack.indexOf(word, from);
        if (at === -1) break;
        matches.push([at, at + word.length]);
        found = true;
        from = at + word.length;
      }
      if (!found) return null;
    }
    matches.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const first = matches[0][0];
    return { score: matches.length + 1 / (1 + first), matches };
  };
}

/** Lower-case `text` without changing its length, so offsets found in the
 *  result are offsets in the original. The few characters whose lower case is
 *  longer (U+0130, for one) are left as they are. */
function lowerCasePreservingLength(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) return lowered;
  let result = "";
  for (const char of text) {
    const lower = char.toLowerCase();
    result += lower.length === char.length ? lower : char;
  }
  return result;
}
