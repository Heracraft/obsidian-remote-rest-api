# Release checks

This file belongs to the project. install.sh makes it once and does not
change it again. The conductor reads it for each batch and each release.
`docs/release-queue/PROCEDURE.md` gives the procedure around it.

## Targets

| Target | Paths that reach it | Release step | The person who may run the step |
|---|---|---|---|
| `none` | docs other than the OpenAPI spec, tests, notes, CI | nothing | |
| `image` | `src/*`, `docs/openapi.yaml`, `docs/src/*`, `Dockerfile`, `.dockerignore`, `esbuild.config.mjs`, `package.json`, `package-lock.json` | the Release Process in `AGENTS.md`: a `Release X.Y.Z` commit, an annotated tag `X.Y.Z`, `git push origin main X.Y.Z` | the conductor, after the owner says yes and picks major, minor or patch |

## Checks for each batch

The conductor runs these checks in the batch worktree, on the merged tree.

Always:

```
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build-docs && git diff --exit-code -- docs/openapi.yaml
```

For `image`, the integration suite against the built container on an
empty folder:

```
docker build -t obsidian-remote-rest-api:batch .
mkdir -p "$TMPDIR/rq-vault"
docker run -d --name rq-it --user "$(id -u):$(id -g)" -v "$TMPDIR/rq-vault:/vault" \
  -p 127.0.0.1:27123:27123 -p 127.0.0.1:27124:27124 \
  -e ENABLE_INSECURE_SERVER=true -e API_KEY=rq-key obsidian-remote-rest-api:batch
OBSIDIAN_API_KEY=rq-key OBSIDIAN_HTTPS_HOST=https://127.0.0.1:27124 \
  OBSIDIAN_VAULT_PATH="$TMPDIR/rq-vault" npm run test:integration
docker rm -f rq-it && rm -rf "$TMPDIR/rq-vault"
```

Notes for this project:

- The integration suite must run alone (`--runInBand`, which the script
  sets) and needs ports 27123 and 27124 free on loopback.
- `build-docs` needs go-jsonnet 0.22.0, the one CI uses.

## Release order

1. Push `main` and the tag together: `git push origin main X.Y.Z`.
2. Watch `.github/workflows/release.yml` (`gh run watch`) until the image
   for amd64 and arm64 is on `ghcr.io/heracraft/obsidian-remote-rest-api`.

## Live checks

On a machine on the owner's tailnet, with a scratch folder, never a real
vault:

```
docker run --rm -d --name live -v "$TMPDIR/live:/vault" -p 127.0.0.1:27124:27124 \
  -e API_KEY=live ghcr.io/heracraft/obsidian-remote-rest-api:X.Y.Z
curl -sk https://127.0.0.1:27124/ | jq .manifest.version
docker rm -f live
```
