<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

# The release procedure

Several agents build on one repository at the same time. Each agent works
on its own branch in its own worktree, and queues the branch when it is
done. One session, the conductor, merges the queue into `main` in verified
batches. The conductor releases `main` when the owner asks.

This file covers the steps from "a branch is done" to "it is released".
[CONDUCTOR.md](CONDUCTOR.md) covers the rest of the conductor's job.
The project's own checks and release steps are in `docs/RELEASE-CHECKS.md`.

## Terms

| Term | Meaning |
|---|---|
| agent | A coding session (Claude Code, Codex or other) that builds one change on one branch. |
| conductor | The one session that merges the queue, verifies batches and releases. |
| owner | The person who decides when to release. |
| worktree | A git worktree. Each branch has its own. The main checkout stays on `main`. |
| queue | The list of branches that are ready to merge. |
| batch | A set of queued branches that the conductor merges together, on a batch branch. |
| integrate | Merge a verified batch into the local `main`. Nothing is pushed. |
| release | Push `main` and run the release step of each target. |
| target | A thing that a release step ships, for example `web` or `cli`. |

## For an agent that builds a change

1. Start in a new worktree. Do not work in the main checkout.

   ```
   tools/release-queue/release-queue start fix-login
   ```

   The command prints the path of the worktree. Work there.
2. Claim the work with a line in `docs/STATUS.md`. Commit the line.
3. Finish the change with the evidence that its checklist names.
4. Commit, run `git merge main`, and run the checks again.
5. Queue the branch:

   ```
   tools/release-queue/release-queue add --live "sign in on the staging site: the dashboard shows"
   ```

   The `--live` text tells the conductor what to check after the release.
6. Stop. Do not merge into `main`, push, tag or deploy. If the conductor
   asks for a change, make it on the same branch and run `add` again.

### What `add` refuses

| Case | Message starts with |
|---|---|
| The branch is `main`. | `add: this is main` |
| The worktree has uncommitted changes. | `add: <branch> has uncommitted changes` |
| The branch has no commits that `main` does not have. | `add: <branch> has no commits` |
| The branch conflicts with `main`. | `add: <branch> conflicts with main in: <files>` |
| A check in `RQ_ADD_CHECKS` for one of the branch's targets fails. | `add: the check for <target> failed` |

A conflict in the generated decisions index is allowed. The conductor
regenerates the index when it cuts the batch.

`add` records the commit. A later commit needs another `add`. This also
works while the branch is in a cut batch. The conductor takes the new
commit with `resume`, or the next cut takes it.

`tools/release-queue/release-queue ls` shows the queue. It marks a branch
that moved after its `add`. Queue that branch again, or the batch takes
the old commit.

## What a branch ships as

`add` reads the diff of the branch against `main`. It gives the targets
that the diff reaches. The rules are in `.release-queue.conf`
([CONFIG.md](CONFIG.md)):

- A path rule maps a glob to targets, for example `'web/* web'`.
- A Go rule maps a binary to targets, for example `'cmd/server api'`. A
  changed package counts for each binary that imports it (`go list -deps`).
- A branch that matches no rule ships as `none`.

The result is a guide for the conductor. It can report too much. For
example, a binary that has a version stamp is different after each build,
so a rule on build output matches each change. Use source paths in the
rules. Check the list before you release.

## For the conductor: integrate

Integrate merges verified branches into `main` on this machine only.
Agents branch from that `main`, so they see each other's work early.
Integrate needs no approval from the owner. Do it each time branches are
in the queue.

1. **See the queue.** Run `tools/release-queue/release-queue ls`. Ask each
   agent with a branch in progress if it is about to queue.
2. **Cut.** Run `tools/release-queue/release-queue cut`. It makes a batch
   worktree from `main` (for example `../project-r20261003-1`, on branch
   `release/r20261003-1`). It merges each queued branch in queue order,
   each with `--no-ff`.
   - If the only conflict is in the generated index, the tool
     regenerates the index and continues.
   - Any other conflict stops the cut. Resolve it in the batch worktree
     and commit. Or send it back to the branch's agent and `drop` the
     branch. Then run `tools/release-queue/release-queue resume <batch>`.
   - `tools/release-queue/release-queue abandon <batch>` removes the batch
     and queues its branches again.
3. **Freeze the batch.** A commit that comes in after the cut goes to the
   next batch, unless it fixes this batch. Each commit that you take in
   means that you verify again.
4. **Verify the merged tree.** Run each check of
   `docs/RELEASE-CHECKS.md` for the batch's targets, in the batch worktree.
   Two branches that pass alone can fail together.
   - Fix a failure in the batch worktree when the merge caused it.
   - Send a failure back to the branch's agent when the branch caused it.
5. **Move `main` on this machine.** In the main checkout (it must be
   clean), run `git merge --ff-only release/<batch>`. Then run
   `tools/release-queue/release-queue done <batch>`. It refuses until
   `main` has the batch. Then it removes the batch worktree.
6. **Do not push.** `ls` now shows the branches as `on-main`. Its last line
   gives what `main` has that is not released, and the targets.
7. **Tell each agent** that its branch is on `main`. The agent merges
   `main` before its next `add`.

## For the conductor: release

Release when the owner asks. A release costs deploys, tags and live
checks, so let `main` fill first. A fix for a production failure is the
exception. Tell the owner that the push also ships each change that is
integrated before it.

If a push of `main` deploys (`RQ_PUSH_DEPLOYS=yes`), nobody pushes
`main` between releases. That includes the conductor and commits that
change only docs. CI runs on the push only, so the batch verification is
the only gate until then.

1. **Ask once.** `tools/release-queue/release-queue ls` gives what `main`
   has that is not released. Send the owner one summary: each branch with
   one line, the targets, and the effect of each release step on users.
   A "yes" covers the steps that the owner has approved before. Ask again
   for each step that `docs/RELEASE-CHECKS.md` marks as the owner's.
2. **Push `main`.** Watch CI on the pushed commit. Fix a red run at once,
   as a small batch of its own.
3. **Run the release steps** for each target, in the order that
   `docs/RELEASE-CHECKS.md` gives. Write the release notes in the style of
   [RELEASE-NOTES-STYLE.md](RELEASE-NOTES-STYLE.md).
4. **Check it live.** Run each released branch's `--live` check. Use test
   accounts and test data. Keep the output.
5. **Record it.** Add one line to `docs/STATUS.md` for the release: the
   branches, the targets with versions, the live evidence and anything not
   done. The line goes into `main` with the next batch. Do not push it alone.
6. **Tell each agent** whose branch is released. The agent can then remove
   its worktree.

## The verification checklist

Copy this list into `docs/RELEASE-CHECKS.md` and fill in each command.
Close each item with the command and its output.

| Item | Evidence |
|---|---|
| The index is current | output of the index check, for example `tools/release-queue/decisions-index --check` |
| The tree builds | the build command and its exit code |
| The linters are clean | the lint commands and their counts |
| The tests pass on the merged tree | the test command, with counts of passed and failed tests |
| The docs match the code | the project's docs check |
| New user-facing lines give only help that was asked for | the guards of TRUST-THE-READER.md, and a read of each new CLI line, page and screen as a user on the fiftieth visit |
| The suites that need a browser or fixed ports pass | each suite, run alone |
| Each target builds | the build of each target in the batch |

Test notes that apply to many projects:

- Run browser and end-to-end suites alone. Two suites that serve on the
  same port fail together.
- Keep `TMPDIR` short when tests make unix sockets, for example
  `TMPDIR=/tmp/t`. A socket path has a limit of 108 bytes.
- A test that passes here and fails in CI often depends on the `PATH` of
  this machine.

## Where the queue is

The state is in the common git directory of the checkout, at
`.git/release-queue/`. Each worktree of the checkout shares it. No branch
has it.

| Path | Content |
|---|---|
| `entries/` | One file for each queued branch: commit, targets, live check, state. |
| `releases/` | One file for each batch: base commit, merged commits, targets. |
| `ids` | The reserved decision ids. |
| `lock` | The flock that each command holds. |

A queue operation makes no commit, so it cannot conflict. The merge
commits on `main` are the record that stays.
The release lines in `docs/STATUS.md` are part of that record.

## Entry states

| State in `ls` | Meaning |
|---|---|
| `queued` | Ready for the next cut. |
| `cut:<batch>` | Merged into a batch that is not on `main` yet. |
| `on-main:<batch>` | On the local `main`, not released. |
| `released:<batch>` | The released ref (`RQ_RELEASED_REF`) has the commit. Only `ls --all` shows it. |
| `dropped` | Taken off the queue. Only `ls --all` shows it. |
