<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

# Trust the reader

This rule applies to each line that a user of the project reads: CLI
output, docs, the site and app copy, emails, and the instructions that
agents read. Agents write most of these lines, and agents make this
mistake often.

## The rule

Say what is true, in the place where the reader looks for it, one time.
Then stop.

- Give help that the reader asked for. A reader asks when they open
  `--help`, a docs page or a tutorial. A reader who gets an error is
  stuck, and that is also a request for help.
- Remove help that nobody asked for. Examples: the next command after a
  command that worked, a footer that explains a table, reassurance,
  text that describes what the screen already shows, and "next, read X".

The test for each line: think of a user who reads it for the fiftieth
time. If the line gives that user nothing, remove it. Keep it only when
it prevents a loss that the user cannot undo, or when it unblocks the
user.

## The problem

An agent writes for an imagined beginner who is lost. The real reader
is not lost. They ran the command many times, or they came to the docs
page for one answer.

Each helpful line is added alone, and alone it looks kind. Together the
lines cost each reader attention on each read. They also tell the user
that the product doubts the user.

## The failure mode

Review does not catch it. A reviewer reads one diff, and in one diff
the hint is one friendly line. The cost shows only on the hundredth run,
under output that the user asked for.

Listings collect the most hints. Each feature adds its own line under
the same table. Scripts that count or search lines see the extra lines
too.

A real case: a CLI printed a line under its project table for each
temporary machine, "`tool keep NAME` keeps it". The owner saw two of
these lines under a table of six projects and called it "such
handholding". The time that was left went into a column, and the lines
went away.

## By surface

CLI output:

- A line for a command that worked tells the result, and stops.
  "Stopped app in 4s. Disk is still billed." stays. "`tool rm app` to
  stop that" goes.
- A next command goes only after a failure, a refusal, a warning that
  work did not go, or a change that does nothing until the user acts
  (for example, a new kernel that waits for a restart).
- State that belongs to a row of a table goes in a column. It does not
  go in a line under the table.

Docs:

- A page gives what its title promises.
- Do not describe what the reader is about to see. Do not reassure
  ("nothing to type", "don't worry", "that's it"). Do not end with
  "next, read X". Do not restate the previous paragraph.
- Each fact has one page. Other pages link to it.
- A tutorial walks through steps, because the reader opened it for that.
  It still skips what the screen shows.

Site, app and emails:

- A heading is its title. Add one sentence of fact when the screen
  cannot show the fact.
- No instructions for how to read the page. No next step in a toast for
  an action that worked.
- An empty state says that it is empty. It tells how to add an item only
  when the screen has no way to add one.
- An email that the user did not ask for gives the fact, the date or the
  amount, and the one action when the user must act.

Agent instructions:

- Give the facts and the commands that the agent needs. Remove
  encouragement and repetition.

## Make it stick

A rule in a file stops nothing when a reviewer reads one diff at a
time. Use three layers.

1. **Tests.** A grep catches only phrasings, but it catches them each
   time.
   - CLI: a test that parses the CLI source and fails on a string that
     names one of the tool's own commands, unless the string is on an
     error path or in help text. An allowlist with a reason for each
     entry covers real exceptions. The test also fails on an allowlist
     entry that matches nothing.
   - Docs, copy and emails: one list of phrasings that a test checks in
     each page, screen and template. Start with: "nothing to type",
     "don't worry", "that's it", "that's all", "you're all set", "you can
     now", "simply", "just run", "you're looking at", "as mentioned
     above", "in other words", "next, read", a "Next steps" heading.
2. **Gates.** Put the tests in `RQ_ADD_CHECKS` in `.release-queue.conf`.
   Then `add` refuses a branch that fails them. Also put them in the
   project's "always" checks in `docs/RELEASE-CHECKS.md`.
3. **Instructions.** The agent rules block in `CLAUDE.md` and
   `AGENTS.md` has this rule. Add the project's examples to the project
   part of `CLAUDE.md`.

The tests cannot judge prose. A command that the code builds at run time
also passes a source scan. So the conductor reads the new user-facing
lines of each batch as a user on the fiftieth visit, and sends back the
lines that fail the test.
