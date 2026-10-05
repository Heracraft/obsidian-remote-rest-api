---
name: release
description: Conductor work on the release queue (/release integrate, /release ship). integrate merges the queued worktree branches into local main in a verified batch and does not push. ship runs only when the owner asks for a release. It pushes main, runs the release steps for each target, runs the live checks and records the release.
---

<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

You are the conductor of the release queue. Read
`docs/release-queue/PROCEDURE.md` in full first. Then read
`docs/RELEASE-CHECKS.md` for the checks and release steps of this project,
and `docs/release-queue/CONDUCTOR.md` for the rest of the conductor's job.

`$ARGUMENTS` gives the job: `integrate` (the default) or `ship`.

**integrate** (it needs no approval from the owner):

1. Run `tools/release-queue/release-queue ls`.
2. List the agent sessions. Ask each agent with a branch in progress if it
   is about to queue. Give your current session name in each message.
3. Run `tools/release-queue/release-queue cut`. If a merge stops on a
   conflict, resolve it in the batch worktree and commit. Then run
   `tools/release-queue/release-queue resume <batch>`.
4. Freeze the batch. A commit that comes in after the cut goes to the next
   batch, unless it fixes this batch.
5. In the batch worktree, run each check that `docs/RELEASE-CHECKS.md`
   gives for the targets of the batch. Paste the commands and their output
   into your notes. "Tests pass" is not evidence.
6. Fix a failure in the batch worktree when the merge caused it. Send it
   back to the branch's agent when the branch caused it.
7. In the main checkout, run `git merge --ff-only <batch branch>`. Then run
   `tools/release-queue/release-queue done <batch>`. Do not push.
8. Tell each agent that its branch is on `main`. The agent merges `main`
   before its next `add`.

**ship** (only when the owner asked for a release):

1. Run `tools/release-queue/release-queue ls`. It shows what `main` has
   that is not released, and the targets.
2. Ask the owner once. Give each branch with one line, the targets, and
   the effect of each release step on users. Stop on "no" or on no answer.
3. Push `main`. Watch the CI run on the pushed commit.
4. Run the release step for each target, in the order that
   `docs/RELEASE-CHECKS.md` gives. Write release notes in the style of
   `docs/release-queue/RELEASE-NOTES-STYLE.md`.
5. Run each released branch's `--live` check. Keep the output.
6. Add one line for the release to `docs/STATUS.md`: the branches, the
   targets with versions, the live evidence, and anything not done. It
   goes into `main` with the next batch. Do not push it alone.
7. Tell each agent whose branch is released.
