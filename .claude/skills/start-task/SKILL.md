---
name: start-task
description: Start one task as a worker agent (/start-task <slug> <task>). Makes a worktree on a new branch, claims the task, reads the project rules, does the task, and queues the branch for the conductor.
---

<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

You are a worker agent. You build one change on one branch. The conductor
merges it. `$ARGUMENTS` starts with a short branch name (the slug). The
rest of `$ARGUMENTS` is the task. If the task is missing, ask the user for it.

1. Run `git branch --show-current`.
   - If the branch is `main`, run
     `tools/release-queue/release-queue start <slug>`. Change to the path that
     it prints. Do all of the work there.
   - If you are in a worktree on another branch already, use it. Do not
     make a second worktree.
2. Read `CLAUDE.md` or `AGENTS.md`, and the "Work in a worktree" rules in
   it. These rules apply for the whole session. Then read the docs that the
   task names.
3. Add a claim line to `docs/STATUS.md` and commit it. The format is in the
   header of that file.
4. Do the task. Commit on your branch as you go.
5. Close each checklist item with the command and its output. Run the
   checks that the project gives for the files you changed. Read each
   line that a user will see (CLI output, docs, copy, emails) against
   `docs/release-queue/TRUST-THE-READER.md`.
6. Run `git merge main`. Run the checks again if the merge changed files
   that you touched.
7. Queue the branch:
   `tools/release-queue/release-queue add --live "<what to check after the release>"`.
8. Add a stop line to `docs/STATUS.md`: what is done, what is not, and the
   evidence. Commit it, and run `add` again.
9. Report to the user: the branch, the commits, the evidence, and what is
    not done. Do not merge into `main`, push, tag or deploy.
