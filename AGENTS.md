# Agent Instructions

This repository is a fork of [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api), the Obsidian plugin, that runs the plugin's API as a standalone server in a container over a plain folder. Most of `src/` is the plugin's code and is kept close to upstream so upstream changes merge cleanly. What belongs to this fork:

| Part | Files |
|---|---|
| Stand-in for the `obsidian` module (vault index, metadata cache, link graph, file manager, search, renderer) | `src/standalone/obsidian/` |
| Server entry point, configuration, watcher, health check, image scaler | `src/standalone/*.ts` |
| Network restrictions (private networks only) | `src/standalone/network.ts` |
| Build (aliases `obsidian` to the stand-in) | `esbuild.config.mjs` |
| Container | `Dockerfile`, `.dockerignore`, `compose.yaml`, `examples/` |
| CI and image releases | `.github/workflows/` |

The plugin's code type-checks against the real `obsidian` typings; only the bundle swaps in `src/standalone/obsidian`. When plugin code starts using an Obsidian API the stand-in lacks, the integration suite fails against the container, and the stand-in grows to match.

## Commit Process

### Commit cadence

Commit frequently in small, self-contained increments. Each commit on `main` must leave the repository in a working state: no broken builds, no failing unit tests. A commit that fixes a bug, a commit that adds a test, and a commit that updates documentation are all valid atomic units. Do not batch unrelated changes into a single commit.

When working on fixing a bug while on a branch off of `main`, follow a Test-Driven Development approach and start by creating (and committing) failing tests that will later be fixed by fixes your subsequent commits.

### Running tests before committing

Run the unit tests, the type check and the linter before every commit:

```
npm test
npm run typecheck
npm run lint
```

The integration tests run against a live server. Run them before pushing any change that touches endpoint behaviour or `src/standalone/`. The simplest live server is the container on an empty folder:

```
npm run docker:build
mkdir -p /tmp/it-vault
docker run -d --name it --user "$(id -u):$(id -g)" -v /tmp/it-vault:/vault \
  -p 127.0.0.1:27123:27123 -p 127.0.0.1:27124:27124 \
  -e ENABLE_INSECURE_SERVER=true -e API_KEY=it-key obsidian-remote-rest-api:dev
OBSIDIAN_API_KEY=it-key OBSIDIAN_HTTPS_HOST=https://127.0.0.1:27124 \
  OBSIDIAN_VAULT_PATH=/tmp/it-vault npm run test:integration
docker rm -f it
```

`npm run build && VAULT_PATH=/tmp/it-vault ENABLE_INSECURE_SERVER=true API_KEY=it-key npm start` works too, without Docker. CI runs the container variant on every push.

The integration tests read these variables:

- `OBSIDIAN_HOST` (default `http://localhost:27123`) and `OBSIDIAN_API_KEY` (required): the HTTP listener and its key.
- `OBSIDIAN_HTTPS_HOST` (default `https://localhost:27124`): the HTTPS listener, for the certificate tests.
- `OBSIDIAN_VAULT_PATH=<absolute path of the served folder>`: enables the configuration-directory symlink test, which plants a symlink to `.obsidian` under the fixture directory and removes it afterwards.
- `OBSIDIAN_SIGNED_URLS=0`: skips the signed-URL round trip. Without it, that test fails, naming the setting, when the server runs with `ENABLE_SIGNED_URLS=false`.

### Commit message format

Use a plain imperative subject line (no `type:` prefix). Always include a `Co-Authored-By` trailer crediting the AI assistant that helped author the commit.

```
Short imperative description

Longer description of what this work is, why these changes were made, and any decisions, trade-offs, and known limitations that may be useful to future readers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Prose in commits, docs and messages: no emojis, no em dashes.

## Taking in upstream changes

`upstream` is the plugin's repository. Merge its `main` (or a release tag) into a branch, never rebase this fork onto it:

```
git fetch upstream
git merge upstream/main
```

Expect conflicts where this fork removed the GUI-only features (`/active/`, `/commands/`, `/open/`, the workspace emitter, the plugin settings tab in `src/main.ts`) and where it reworded messages that pointed at plugin settings. Keep them removed. A new Obsidian API call in upstream code needs the stand-in in `src/standalone/obsidian/` to implement it; the integration suite against the container says whether it does.

## Keeping REST, MCP, and Documentation in Sync

This project has several parallel representations of each API capability that must be kept consistent. When any one changes, the others must be updated in the same commit.

| Layer | Files |
|---|---|
| REST API implementation | `src/requestHandler.ts` |
| MCP tool definitions | `src/mcpHandler.ts` |
| Project Readme | `README.md` |
| OpenAPI docs (source) | `docs/src/openapi.jsonnet`, `docs/src/lib/descriptions/*.md` |
| OpenAPI docs (compiled) | `docs/openapi.yaml` |
| Unit tests | `src/requestHandler.test.ts`, `src/mcpHandler.test.ts`, `src/standalone/**/*.test.ts` |
| Integration tests | `src/integration/*.test.ts` |
| Server configuration | `src/standalone/config.ts`, the Configuration table in `README.md`, `compose.yaml` |

After making any changes to REST API endpoints or MCP tools, update the matching OpenAPI docs and Readme entries. A new environment variable goes into `src/standalone/config.ts`, its test in `src/standalone/config.test.ts`, and the Configuration table in the Readme, in the same commit.

### When changing a REST endpoint

- **New parameter**: add it to the route handler in `src/requestHandler.ts`, add the corresponding Zod field to the matching `mcpServer.tool()` call in `src/mcpHandler.ts`, document it in the relevant Jsonnet source under `docs/src/`, and add test coverage in both the relevant unit test file and the relevant `src/integration/*.test.ts` file.
- **Removed or renamed parameter**: mirror the removal or rename across all layers.
- **Changed behavior or response format**: update the OpenAPI description in `docs/src/lib/descriptions/` and the MCP tool description string in `src/mcpHandler.ts`.
- **New endpoint entirely**: all layers need additions: route handler, MCP tool, Jsonnet operation block, regenerated `docs/openapi.yaml`, and test coverage in both the unit and integration test files.

### The network restrictions

`src/standalone/network.ts` keeps the server off the public internet: it refuses public binding addresses, public source addresses, and proxied public clients unless `ALLOW_PUBLIC_CLIENTS_THROUGH_AUTHENTICATING_PROXY` is set. Do not add a way around these checks, widen the default networks, or make the opt-in quieter. A change here needs tests in `src/standalone/network.test.ts`, and the Exposure section of the Readme must still describe exactly what the server enforces.

### Regenerating the compiled OpenAPI spec

`docs/openapi.yaml` is generated from the Jsonnet source and must be regenerated after any change to `docs/src/`. The server and `src/mcpHandler.ts` embed it, and CI fails when it is stale. CI uses go-jsonnet (`go install github.com/google/go-jsonnet/cmd/jsonnet@v0.22.0`); use the same one locally so the output matches.

```
npm run build-docs
```

### Regenerating the Readme table of contents

`README.md` carries a `markdown-toc`-generated table of contents between the `<!-- toc -->` and `<!-- tocstop -->` markers. After adding, removing, or renaming any Readme heading, regenerate it and stage the result:

```
npm run build-toc
```

### Checklist

Before marking any endpoint-related change complete:

- [ ] `src/requestHandler.ts` implements the behavior
- [ ] `src/mcpHandler.ts` exposes matching parameters and an accurate description
- [ ] `docs/src/` Jsonnet/Markdown reflects the change
- [ ] `docs/openapi.yaml` has been regenerated (`npm run build-docs`)
- [ ] `README.md`'s table of contents has been regenerated if headings changed (`npm run build-toc`)
- [ ] Unit tests cover the changed behavior
- [ ] Integration tests in `src/integration/` cover the changed behavior and pass against the container

## Release Process

A release is an annotated tag `X.Y.Z` on `main`. Pushing it makes `.github/workflows/release.yml` build the image for amd64 and arm64, push `X.Y.Z`, `X.Y` and `latest` to `ghcr.io/heracraft/obsidian-remote-rest-api`, and create a GitHub release whose notes are the tag message. Every push to `main` also publishes `edge`.

### Steps

1. Be on `main` with all intended changes merged and CI green.

   Read the current version from `package.json`. Ask the user whether this is a **major**, **minor**, or **patch** bump and calculate the new version number from their answer; do not ask them to supply the version number directly.

2. Delete `package-lock.json` and regenerate it:
   ```
   rm package-lock.json
   npm i
   ```

3. Edit the `version` field in `package.json` to the new version number. The server reports it as `manifest.version` in `GET /`.

4. Stage `package.json` and `package-lock.json` and create a commit named `Release X.Y.Z`.

5. Draft the full tag message and present it to the user for review. Incorporate any requested changes, then create the annotated tag named exactly after the new version number (no `v` prefix):
   ```
   git tag -a 0.2.0
   ```

   **Tag message format:**

   ```
   Release X.Y.Z

   - Adds/Fixes/Updates/Removes [description of change]. (#issue if applicable; Thanks @contributor if applicable.)
   - Adds/Fixes/Updates/Removes [description of change].
   ```

   - Subject line is `Release X.Y.Z`, optionally followed by ` -- Short description` for especially notable releases.
   - Body is one or more bullet points summarizing user-visible changes, each starting with a verb (`Adds`, `Fixes`, `Updates`, `Removes`).
   - Name the upstream plugin version when the release takes in upstream changes (`Updates the API to obsidian-local-rest-api 5.4.0.`).
   - Credit external contributors where relevant; look up GitHub handles with `gh pr view <number>`.

6. Push `main` and the tag, then watch the release workflow until the image is published:
   ```
   git push origin main 0.2.0
   gh run watch
   ```
