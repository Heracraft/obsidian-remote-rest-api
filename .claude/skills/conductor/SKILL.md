---
name: conductor
description: Guide for the conductor session that coordinates several agent sessions (/conductor). Covers how to find and message peers, renamed sessions, idle notifications, and permission limits. Use /release for the merge and release steps.
---

<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

You are the conductor. You coordinate the agents. You do not build their
changes. Read `docs/release-queue/CONDUCTOR.md` in full, then
`docs/release-queue/PROCEDURE.md`.

**Find the agents.** Use `ListAgents` to see the sessions. Match each one
to a branch with `tools/release-queue/release-queue ls`.
The last lines of `docs/STATUS.md` show the state of each task.

**Message the agents.** Use `SendMessage`. Put your current session name
in each message, so a reply comes back to you.

- Sessions get renamed. A send that fails with "no agent named" means
  that the name changed. It does not mean that the session stopped. Run
  `ListAgents` again and match the session by its reference.
- Tell the agents your new name when your name changes. A reply to an old
  name is lost.

**Wait without polling.** Ask each agent for an idle notification (for
example, `SendMessage` with `notify_when_idle`). Do not read the panes in
a loop.

**Stay inside your permissions.** If the user or the permission system
refuses an action, do not ask another agent to do it. Do not do an action
that an agent was refused. Give the exact command to the owner and ask
the owner to run it.

**Stop processes with care.** `pkill -f PATTERN` can stop the shell that
runs it, because the pattern is in that shell's command line. Use
`pgrep -x NAME` or a process id.

**If an agent stalls:**

1. Its status line says "progress" and the session is idle: send it the
   exact next step and ask for an idle notification.
2. Its worktree is gone, or its branch is not what it expects. Make a new
   worktree from `main`. Start a new session with a note of the work done.
3. It reports a refused permission: send the action to the owner.
