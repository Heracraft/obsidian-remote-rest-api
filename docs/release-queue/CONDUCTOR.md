<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

# The conductor

The conductor is one long session that coordinates several agents. It
merges and releases their work. It does not build their changes.
[PROCEDURE.md](PROCEDURE.md) gives the merge and release steps. This file
gives the rest of the job, and the rules that came from practice.

## Roles

| Role | Job |
|---|---|
| conductor | Starts and restarts agents. Merges the queue in batches. Verifies each batch. Releases when the owner asks. Fixes problems that block more than one agent. |
| agent | Builds one change on one branch in its own worktree. Queues the branch. Does not merge, push, tag or deploy. |
| owner | Decides when to release. Runs each action that costs money or that the conductor's permissions refuse. Answers the questions that only a person can answer. |

## Start agents

1. Split the work into tasks that change different files. Two tasks that
   change the same file make conflicts at merge time.
2. Give each task a short branch name (the slug).
3. Start one session for each task. In Claude Code, the session runs
   `/start-task <slug> <task>`. In another agent, put the same text in the
   first prompt: "Read AGENTS.md. Then run
   `tools/release-queue/release-queue start <slug>` and do this task: ..."
4. Name the files that the agent can change. Name the evidence that you
   want in its report.
5. Run four to six agents at a time on an 8-core machine. More agents make
   builds wait for each other.

## Talk to agents

- List the sessions with `ListAgents`. Send messages with `SendMessage`.
- Put your current session name in each message.
- Sessions get renamed. A send that fails with "no agent named" means that
  the name changed. Run `ListAgents` again and match the session by its
  reference. Then tell each agent your current name, because a reply to an
  old name is lost.
- Ask each agent for an idle notification (`SendMessage` with
  `notify_when_idle`) when it starts a long step. Do not poll its pane.
- An agent that finds a problem for all agents (a contract change, a bug
  in merged code) sends it to the conductor at once.

## Permissions

- If the permission system or the owner refuses an action, do not ask an
  agent to do it. Do not do an action that an agent was refused.
- Give the exact command to the owner and ask the owner to run it. For
  example, put the command in a tmux buffer and give its name.
- An action comes back to the conductor only when the owner says so in
  words.
- Tell the owner before an action that stops live sessions or users.

## Merge rules from practice

- **Read new user-facing lines as a user on the fiftieth visit.** Send
  back a next command after a command that worked, reassurance, and a
  fact that a second page repeats. The guards catch phrasings only.
  [TRUST-THE-READER.md](TRUST-THE-READER.md) gives the rule.
- **Merge in a batch worktree.** `release-queue cut` makes it. The main
  checkout stays usable while you verify.
- **Use union merge for append-only logs.** `.gitattributes` marks the
  status log and the decisions log as `merge=union`. Lines that parallel
  branches add do not conflict. Resolve each other file by hand.
- **Get decision ids from the tool.** Agents that count ids from their copy
  of `main` give the same id to two decisions. `release-queue id` reads
  each branch, each worktree's uncommitted log and a reservation list
  under one lock.
- **Let the tool regenerate the index.** Each branch that adds a decision
  changes the generated index, so two such branches always conflict there.
  `add` allows a conflict in the index only. `cut` regenerates it.
- **Take one side of a lock file, then regenerate it.** For example, for
  `go.sum`, take one side, run `go mod tidy`, and build again.
- **Write a generated or shared config file again as one file.** A merge
  of hunks in a file that many branches add entries to can give a
  duplicate key. Check it with the tool that reads the file.
- **Keep the canonical copy of duplicate work.** Two agents can write the
  same module. Keep one, move the other under its user, and record the
  debt as a decision.
- **Tell agents after each integrate.** An agent with no local commits
  can fast-forward. An agent with commits runs `git merge main`.
- **Remove a worktree only when no session runs in it.** A session whose
  worktree is gone cannot commit. Stop it and start a new session in a new
  worktree.

## Rules for the shell

- Under `set -euo pipefail`, a `grep -v` that gives no lines stops the
  script with no message. Guard each such pipeline, for example
  `{ grep -v x || true; }`.
- `pkill -f PATTERN` can stop the shell that runs it, because the pattern
  is in that shell's command line. Use `pgrep -x NAME` or a process id.
- Run a long command with its log in a file, and watch the log. For
  example: `make deploy > ~/deploy.log 2>&1 &`. You can do other work while
  it runs.

## When an agent stalls

| Sign | Action |
|---|---|
| Its status line says "progress" and the session is idle. | Send the exact next step. Ask for an idle notification. |
| Its worktree is gone, or its branch is not what it expects. | Stop the session. Make a new worktree from `main`. Start a new session with a note of what is done. |
| It reports a refused permission. | Send the action to the owner. Do not do it for the agent. |
| It sent a reply to an old conductor name. | Tell it your current name. Ask it to send the reply again. |

## Signals to watch

- Idle notifications from agents.
- `release-queue ls`: new entries, and entries marked as moved.
- The CI run on each push of `main`.
- The last lines of the status log on each branch, for example
  `git show fix-login:docs/STATUS.md | tail -n 3`.

## Integrate often, release on request

Integrate each verified batch into `main` on this machine as soon as it
passes. Agents then build on each other's work, and conflicts stay small.
Release only when the owner asks. A release costs deploys, tags and live
checks, and the owner wants several changes in each one. If a push of
`main` deploys, nobody pushes `main` between releases.
