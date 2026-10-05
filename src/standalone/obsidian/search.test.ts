import { prepareSimpleSearch } from "./search";

describe("prepareSimpleSearch", () => {
  test("matches every word, case-insensitively, and lists each occurrence", () => {
    const result = prepareSimpleSearch("Foo bar")("foo and BAR and foo");
    expect(result?.matches).toEqual([
      [0, 3],
      [8, 11],
      [16, 19],
    ]);
  });

  test("does not match when one word is missing", () => {
    expect(prepareSimpleSearch("foo missing")("foo")).toBeNull();
  });

  test("an empty query matches nothing", () => {
    expect(prepareSimpleSearch("   ")("anything")).toBeNull();
  });

  test("scores more occurrences and earlier matches higher", () => {
    const search = prepareSimpleSearch("note");
    const many = search("note note note").score;
    const early = search("note").score;
    const late = search("xxxxxxxx note").score;
    expect(many).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(late);
  });

  test("offsets stay right when lower-casing would change the length", () => {
    const text = "İstanbul note";
    const [match] = prepareSimpleSearch("note")(text).matches;
    expect(text.slice(match[0], match[1])).toBe("note");
  });
});
