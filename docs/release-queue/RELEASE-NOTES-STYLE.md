<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

# Release notes style

Write release notes about 80% of the way to ASD-STE100 Simplified Technical
English. Readers scan release notes. Some readers do not have English as
their first language, and some use a translation tool. Short, plain
sentences serve each of them.

## Rules

| Rule | Example |
|---|---|
| Write sentences of 20 words or fewer. | "The `ls` command shows 50 rows on each page." |
| Give one statement in each sentence. | Two facts make two sentences. |
| Use the active voice. | "The server rejects an empty name." |
| Use the simple present or the simple past tense. | "The command shows" or "The command showed". |
| Use the approved simple verbs: is, has, shows, gives, accepts, writes, uses, makes, starts, stops. | "The tool writes the index" in place of "the tool takes care of the index". |
| Do not use idioms or figurative verbs. | "The change is in version 1.4" in place of "the change lands in 1.4". |
| Use one term for one thing. | Choose "project" or "repository" and keep it. |
| Keep the articles (a, an, the). | "Run the command" in place of "Run command". |
| Give an example with a real command. | "For example: `tool ls --all`." |
| Give real numbers. | "Start time is 7 s (it was 27 s)." |
| Do not use em dashes, emojis or filler words. | |

## Structure

```
## <version>

### Highlights
- <the change that most users notice, in one or two sentences>
- <the next one>

### Other changes
- <one line for each change>

### Upgrade
- <a step that users must do, or "No action is necessary.">
```

## Before and after

Before:

> We've totally revamped how listing works under the hood, so `tool ls`
> now flies through huge result sets, and paging is handled for you
> automatically: no more truncated output when you've got hundreds of
> items lying around.

After:

> `tool ls` shows each item. It shows 50 rows on each page. Before this
> release, it showed the first 100 items only. Use `tool ls --page 2` for
> the second page.

The second text has four sentences. Each sentence has one fact. The
reader gets the number, the old behaviour and a real command.

## Check before you publish

1. Count the words in each long sentence. Split a sentence of more than
   20 words.
2. Search for each term that has two names in the text. Keep one name.
3. Replace each figurative verb (for example "lands" or "flies")
   with a plain verb.
4. Confirm each number with a measurement or a link.
