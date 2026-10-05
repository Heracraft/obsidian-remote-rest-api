<!-- managed by agent-release-queue 0.2.0; install.sh replaces this file on update -->

# Configuration

`release-queue` reads `.release-queue.conf` at the top of the worktree. If
that file is absent, it reads the file in the main checkout. The variable
`RQ_CONFIG` gives another path. The file is bash, and the tool sources it.
Commit it, so each worktree uses the same values.

`install.sh` writes a starter file once. Later runs do not change it.

## Keys

| Key | Default | Meaning |
|---|---|---|
| `RQ_MAIN` | `main` | The branch that batches are integrated into. |
| `RQ_RELEASED_REF` | `origin/main` | The ref that counts as released. `ls` shows a merged branch as `released` when this ref has its commit. The tool reads the local remote-tracking ref. It does not fetch. |
| `RQ_PUSH_DEPLOYS` | `no` | `yes` when a push of `RQ_MAIN` deploys. Then `done` tells the conductor not to push. |
| `RQ_WORKTREE_PATTERN` | `../{checkout}-{name}` | The path of the worktrees that `start` and `cut` make. A relative path is relative to the main checkout. `{checkout}` is the directory name of the main checkout. `{name}` is the branch name or the batch id. |
| `RQ_BATCH_BRANCH_PREFIX` | `release/` | The prefix of batch branches. `add` refuses a branch with this prefix. |
| `RQ_DECISIONS_FILE` | empty | The decisions log. Empty means that the project has none, and `id` refuses. |
| `RQ_ID_PREFIX` | `D-` | The prefix of decision ids, for example `D-`, `ADR-` or `I-`. |
| `RQ_ID_WIDTH` | `0` | The width of the number, with zeros in front. `4` gives `ADR-0012`. `0` gives `D-12`. |
| `RQ_INDEX_FILE` | empty | The generated index of the decisions log. |
| `RQ_INDEX_CMD` | empty | The command that writes the index. It runs with bash at the top of a worktree. |
| `RQ_STATUS_FILE` | empty | The status log. Only `install.sh` reads it. |
| `RQ_CHECKS_FILE` | `docs/RELEASE-CHECKS.md` | The project's checks and release steps. Only `install.sh` reads it. |
| `RQ_PROCEDURE` | `docs/release-queue/PROCEDURE.md` | The procedure that messages point to. `install.sh` copies the toolkit docs into its directory. |
| `RQ_TARGETS` | `()` | Path rules, a bash array. See below. |
| `RQ_GO_BINARIES` | `()` | Go binary rules, a bash array. See below. |
| `RQ_ADD_CHECKS` | `()` | Checks that `add` runs before it queues a branch, a bash array. See below. |

The index is used only when `RQ_INDEX_FILE` and `RQ_INDEX_CMD` both have
a value. Then `add` allows a conflict in the index, and `cut` regenerates
the index after each conflict and once at the end.

## Path rules

Each rule is one string: `GLOB TARGET[,TARGET...]`.

- `*` in the glob matches any characters, `/` included. For example,
  `web/*` matches `web/src/app.ts`.
- `?` matches one character. `[abc]` matches one of the characters.
- A rule matches when one changed file matches the glob.
- Each rule that matches adds its targets. The tool sorts the targets and
  removes duplicates.
- A branch that matches no rule ships as `none`.

```bash
RQ_TARGETS=(
  'web/* web'
  'migrations/* db,api'
  'flake.nix base,host'
)
```

## Go binary rules

Each rule is one string: `DIR TARGET[,TARGET...]`. `DIR` is the package
path of a binary, relative to the top of the module, for example
`cmd/server`.

- The rules apply only when `go.mod` is at the top of the worktree and
  `go` is on the `PATH`.
- A changed `.go` file marks its package. The binary's targets are added
  when `go list -deps ./DIR` has that package.
- Another changed file (an embedded template, a migration) marks the
  nearest directory above it that has `.go` files. A file outside such a
  directory marks nothing.
- A change to `go.mod` or `go.sum` adds the targets of each binary.

```bash
RQ_GO_BINARIES=(
  'cmd/server api'
  'cmd/admin api'
  'cmd/tool cli'
)
```

## Checks at add

Each rule is one string: `TARGET COMMAND`. `add` runs the command with
bash at the top of the worktree when the branch ships as `TARGET`. The
target `*` matches each branch. A command that fails stops the add. `add`
shows the last 20 lines of its output.

Use these rules for fast guards that agents must not skip. A slow suite
belongs in the conductor's checks for each batch. For example, the guards
of [TRUST-THE-READER.md](TRUST-THE-READER.md):

```bash
RQ_ADD_CHECKS=(
  'cli go test ./internal/cli -run TestSuccessOutputNamesNoCommand'
  'web cd web && npx vitest run src/copy.test.ts'
  '* ./scripts/check-links.sh'
)
```

## Limits of the target rules

The targets are a guide for the conductor. They can report too much:

- A rule on a generated file matches each change that regenerates it.
- A binary that has a version or a commit stamp differs after each build.
  A rule on build output then matches each change. Use source paths.
- A shared config file that many targets read makes each target match.

The rules do not see a change that reaches a target in another way, for
example through a file that the build downloads. Check the targets before
you release.

## Examples

The `examples/` directory of the toolkit has two configs:

- `go-web-nix.conf`: a Go service, a web app and Nix configurations. A
  push of `main` deploys.
- `single-package.conf`: one package that a tag releases.
