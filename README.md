# Remote REST API with MCP

The [Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin for Obsidian, as a standalone server in a container. Mount a folder of markdown notes, an Obsidian vault or any other, and your scripts and AI agents get the plugin's REST API and MCP server for it. Obsidian does not need to be installed.

> [!CAUTION]
> **Do not put this server on the public internet.** One API key gives full read, write and delete access to every note in the folder. Run it on a private network you control: a [Tailscale](https://tailscale.com/) tailnet or a WireGuard tunnel. The server refuses to bind to a public address and refuses clients from public addresses (see [Exposure](#exposure)).

<!-- toc -->

- [What you can do](#what-you-can-do)
- [Quick start](#quick-start)
  * [REST API](#rest-api)
  * [MCP clients](#mcp-clients)
    + [Claude Code](#claude-code)
    + [Claude Desktop](#claude-desktop)
    + [Cursor](#cursor)
- [Exposure](#exposure)
- [Configuration](#configuration)
- [How it differs from the plugin](#how-it-differs-from-the-plugin)
- [Running it without Docker](#running-it-without-docker)
- [API overview](#api-overview)
  * [The configuration directory is off-limits](#the-configuration-directory-is-off-limits)
  * [Browser clients and response headers](#browser-clients-and-response-headers)
- [Patching notes](#patching-notes)
  * [Raw-content mode](#raw-content-mode)
- [Targeting specific sections](#targeting-specific-sections)
- [Searching](#searching)
- [Event streams](#event-streams)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
  * [Protocol revisions](#protocol-revisions)
  * [Available tools](#available-tools)
  * [Binary files and attachments](#binary-files-and-attachments)
  * [Signed URLs](#signed-urls)
  * [Available resources](#available-resources)
- [Contributing](#contributing)
- [Credits](#credits)

<!-- tocstop -->

## What you can do

The REST API and the built-in [MCP server](https://modelcontextprotocol.io/) expose the same operations:

- read, create, update and delete any file in the folder, binary files included
- append, prepend, replace, delete or move one heading, block or frontmatter key, leaving the rest of the file alone
- search by text, or with [JsonLogic](https://jsonlogic.com/) queries over frontmatter, tags, links, backlinks, path and content
- stream note creations, changes and renames as Server-Sent Events, filtered, whoever made them
- share the folder with Obsidian, a sync client or `git`: outside changes reach the API within a second
- list tags with usage counts
- move notes, rewriting the wikilinks and markdown links that point at them

The API is the plugin's own code, so the [interactive API docs](https://coddingtonbear.github.io/obsidian-local-rest-api/) and every client written for the plugin apply, apart from the [features that need the Obsidian window](#how-it-differs-from-the-plugin). The running server also serves its own spec at `/openapi.yaml`.

## Quick start

You need Docker with Compose, a folder of notes, and this machine's address on your Tailscale or WireGuard network.

`compose.yaml`:

```yaml
services:
  obsidian-rest:
    image: ghcr.io/heracraft/obsidian-remote-rest-api:latest
    restart: unless-stopped
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - ${VAULT_DIR}:/vault
    ports:
      - "${BIND_IP}:27124:27124"
    environment:
      API_KEY: ${API_KEY}
      SUBJECT_ALT_NAMES: ${BIND_IP},${SUBJECT_ALT_NAMES:-}
```

`.env`:

```sh
API_KEY=<output of: openssl rand -hex 32>
BIND_IP=100.101.102.103
VAULT_DIR=/home/you/Notes
```

```sh
docker compose up -d
```

Keep `.env` out of version control and readable only by you (`chmod 600 .env`).

[`examples/compose.sync.yaml`](examples/compose.sync.yaml) runs the API next to [obsidian-headless-sync-docker](https://github.com/Belphemur/obsidian-headless-sync-docker), which keeps the folder in sync with Obsidian Sync.

### REST API

```sh
# Check the server is running (no auth required)
curl -k https://100.101.102.103:27124/

# List files at the root of the folder
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://100.101.102.103:27124/vault/

# Read a note
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://100.101.102.103:27124/vault/path/to/note.md

# Read a specific heading (URL-embedded target)
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://100.101.102.103:27124/vault/path/to/note.md/heading/My%20Section

# Append a line to a specific heading (PATCH with a JSON instruction)
curl -k -X PATCH \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  --data '{"targetType":"heading","target":["My Section"],"operation":"append","content":"New line of content"}' \
  https://100.101.102.103:27124/vault/path/to/note.md
```

To drop `-k`, download the server's certificate authority from `https://<host>:27124/obsidian-local-rest-api.crt` and trust it in your OS or browser, or pass it to your client (`curl --cacert obsidian-local-rest-api.crt ...`). The authority is name-constrained: it can only vouch for `127.0.0.1`, `localhost`, the binding host, and the names in `SUBJECT_ALT_NAMES`, so trusting it does not let it (or anyone who obtains its key) impersonate other sites. The certificate covers `BIND_IP`; add host names with `SUBJECT_ALT_NAMES`, which makes a new authority to trust.

Inside a Tailscale or WireGuard tunnel the traffic is already encrypted, so plain HTTP on port 27123 (`ENABLE_INSECURE_SERVER=true`, and publish 27123) is a reasonable way to avoid certificates.

### MCP clients

The MCP server runs at `https://<host>:27124/mcp/` (or `http://<host>:27123/mcp/` with the HTTP listener on) and requires your API key as a bearer token in an `Authorization` header (`Authorization: Bearer <your-api-key>`).

#### Claude Code

```sh
claude mcp add --transport http obsidian https://<host>:27124/mcp/ \
  --header "Authorization: Bearer <your-api-key>"
```

Or add it to `.mcp.json` in your project root (project-scoped) or configure it user-wide via `claude mcp add --scope user`:

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "https://<host>:27124/mcp/",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

#### Claude Desktop

Claude Desktop does not natively support remote HTTP MCP servers, but you can bridge it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (requires Node.js). Add the following to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "mcp-remote@latest",
        "https://<host>:27124/mcp/",
        "--header",
        "Authorization: Bearer <your-api-key>"
      ]
    }
  }
}
```

Restart Claude Desktop after saving the file.

#### Cursor

Add the following to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-specific):

```json
{
  "mcpServers": {
    "obsidian": {
      "url": "https://<host>:27124/mcp/",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

## Exposure

The server refuses:

- a public binding address. `BINDING_HOST` must be a private address: loopback, RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), Tailscale's `100.64.0.0/10`, IPv6 unique-local (`fc00::/7`, which holds Tailscale's `fd7a:115c:a1e0::/48`) or link-local. The default `0.0.0.0` is refused when the machine has any public address, as a VPS or a container with `network_mode: host` would. On Docker's default bridge network the container only sees its private bridge address, so the default is fine there.
- public clients. A request whose source address is outside those networks gets a `403` (error code `40322`) before authentication.
- public clients behind a proxy. A request a proxy forwards on behalf of a public client (`X-Forwarded-For`, `X-Real-IP` or `Forwarded` naming a public address, or something that is not an address) gets the same `403`.
- allow lists wider than the private ranges. `ALLOWED_CLIENT_NETWORKS` narrows the allowed networks, for example to the tailnet alone (`100.64.0.0/10,fd7a:115c:a1e0::/48`). It refuses to start if you list anything outside the private ranges.

The server cannot see where Docker publishes its port. `ports: ["27124:27124"]` publishes on every interface of the host, public ones included. Docker usually preserves the client's address, so the server still refuses the request, but in some setups (IPv6 to an IPv4 container, Docker's userland proxy) the client arrives as the Docker gateway, a private address, and the refusal no longer works. Use one of these, the first if you can:

1. No published port at all. Use the [Tailscale sidecar](examples/compose.tailscale.yaml), and the server is reachable from your tailnet and nowhere else.
2. A port published only on the host's Tailscale or WireGuard address (`BIND_IP` in [`compose.yaml`](compose.yaml)).

Never publish a bare `"27124:27124"`, or on `0.0.0.0` or the host's public IP.

## Configuration

Every setting is an environment variable. Set `API_KEY`; the rest have defaults.

| Variable | Default | Meaning |
|---|---|---|
| `VAULT_PATH` | `/vault` | The folder to serve. |
| `API_KEY` | none | The bearer token. Without it the server generates one on first start, logs it once, keeps it in the data directory, and warns at every start. |
| `DATA_DIR` | `<vault>/.obsidian/plugins/obsidian-remote-rest-api` | Where the generated API key and TLS material are kept. The default sits in the configuration directory, which the API refuses to serve. |
| `CONFIG_DIR` | `.obsidian` | The Obsidian configuration directory's name, which the API refuses to read or write. |
| `PORT` | `27124` | HTTPS port. |
| `INSECURE_PORT` | `27123` | HTTP port. |
| `ENABLE_SECURE_SERVER` | `true` | Serve HTTPS. |
| `ENABLE_INSECURE_SERVER` | `false` | Serve plain HTTP. Only inside a Tailscale or WireGuard tunnel. |
| `BINDING_HOST` | `0.0.0.0` | The address to listen on. Must be private; see [Exposure](#exposure). |
| `ALLOWED_CLIENT_NETWORKS` | the private ranges | Comma-separated CIDRs clients may connect from. Can only narrow the private ranges. |
| `SUBJECT_ALT_NAMES` | none | Comma-separated host names and addresses for the HTTPS certificate. `compose.yaml` adds `BIND_IP`. Changing it generates a new certificate authority. |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | none | Use your own certificate (PEM, chain included) and key instead of the generated ones. |
| `AUTHORIZATION_HEADER_NAME` | `Authorization` | The header that carries the bearer token. |
| `ENABLE_SIGNED_URLS` | `true` | Allow signed URLs ([below](#signed-urls)). |
| `SIGNED_URL_TTL_SECONDS` | `300` | How long a signed URL stays valid. |
| `ENABLE_CONFIG_DIR_ACCESS` | `false` | Let the API read and write the configuration directory. Exposes the stored API key. |
| `UPDATE_LINKS_ON_MOVE` | from `app.json`, else `true` | Rewrite links to a note when `MOVE` moves it. |
| `NEW_LINK_FORMAT` | from `app.json`, else `shortest` | How rewritten links name their target: `shortest`, `relative` or `absolute`. |
| `TRASH` | from `app.json`, else `local` | Where `DELETE` puts files: `local` (the folder's `.trash`), or `none` (delete outright). `system` means `local`, since a container has no system trash. |
| `WATCH` | `true` | Follow changes made to the folder by anything else. |
| `RESCAN_INTERVAL_SECONDS` | `60` | How often to compare the whole folder with the index, for changes the watcher missed. `0` turns it off. |
| `VERBOSE_LOGGING` | `false` | Log each change seen on disk and each refused request. |

The server reads `alwaysUpdateLinks`, `newLinkFormat` and `trashOption` from `.obsidian/app.json` when the folder has one, and an environment variable overrides each.

## How it differs from the plugin

The REST routes, MCP tools, PATCH engine, search, event streams, signed URLs and security checks are the plugin's code, unchanged. The plugin gets the file index, metadata cache and link graph from Obsidian; this server builds them from the folder.

These need the Obsidian window and are not available:

- `/active/` (the open note), `/commands/` (the command palette), `/open/` (opening a note in the UI), and their MCP tools (`active_file_get_path`, `command_list`, `command_execute`, `open_file`).
- The `workspace` event emitter (`file-open`, `active-leaf-change`, `layout-change`).
- API extensions: other Obsidian plugins can register routes with the plugin, and there are no plugins here.

These approximate Obsidian:

- Metadata. Frontmatter, tags, headings, block ids, wikilinks, embeds, markdown links and links in frontmatter are parsed by this server, skipping code blocks, inline code, math and comments as Obsidian does. Unusual markdown can parse differently from Obsidian's parser.
- Link resolution follows Obsidian's rules as far as they are known: relative paths, then exact vault paths, then a matching file name, preferring the note's own folder and then the shortest path. Ties Obsidian breaks differently resolve differently.
- `Accept: text/html` renders with [marked](https://marked.js.org/) plus wikilinks and embeds. Obsidian's themes and plugins do not apply.
- Simple search matches every word of the query case-insensitively. Obsidian does not document its scoring, so the scores differ.
- The index skips dot-folders, as Obsidian does. Files in them stay reachable by path, subject to the configuration-directory guard.
- `versions.obsidian` in `GET /` is `standalone`.

## Running it without Docker

Node 22 or later:

```sh
npm ci && npm run build
API_KEY=<your key> VAULT_PATH=~/Notes BINDING_HOST=100.101.102.103 node dist/server.js
```

## API overview

| Endpoint | Methods | Description |
|---|---|---|
| `/vault/{path}` | GET PUT PATCH POST DELETE | Read, write, or delete any file in your vault |
| `/search/simple/` | POST | Full-text search across all notes |
| `/search/` | POST | Structured search via JsonLogic |
| `/tags/` | GET | List all tags with usage counts |
| `/` | GET | Server status and authentication check |
| `/mcp/` | GET POST | MCP server |

### The configuration directory is off-limits

The API refuses to read or write any file inside Obsidian's configuration directory (`app.vault.configDir`, normally `.obsidian`), for both REST and MCP, reads as well as writes. A request for such a path is rejected with `403` (error code `40321`) at the REST layer or a path error from an MCP tool.

That directory holds plugin code and each plugin's `data.json`, including this server's own, where a generated API key is stored. Writing into it is effectively remote code execution, since Obsidian runs an enabled plugin's `main.js`; reading from it leaks those secrets. Blocking it keeps a credential documented as "vault file access" from silently granting more (see [GHSA-66m9-r757-qvq7](https://github.com/coddingtonbear/obsidian-local-rest-api/security/advisories/GHSA-66m9-r757-qvq7)).

The check uses where a path lands on disk: a Windows 8.3 short name such as `OBSIDI~1`, a differently cased spelling on a case-insensitive filesystem, or a symlink that points into the configuration directory is refused the same way. Search and the tag listing skip any indexed note that lives there too, so a symlinked folder cannot hand the contents out by another route.

If you manage your Obsidian configuration through the API, start the server with `ENABLE_CONFIG_DIR_ACCESS=true`. It is off by default, and turning it on grants every holder of your API key that access, including to the server's own `data.json` in the default data directory.

### Browser clients and response headers

Several endpoints answer in a response header: `Content-Location` names the file a targeted request resolved to, `Markdown-Patch-Warnings` reports what a `PATCH` had to work around, `Deprecation` warns that a format is sunsetting, and `Mcp-Session-Id` carries the session for a sessionful MCP connection.

Browsers hide response headers from JavaScript unless the server opts them in, so the API sends `Access-Control-Expose-Headers: *` and all of them are readable with `response.headers.get(...)`. Safari honours the wildcard from 15.4 onward; older browsers see only the [CORS-safelisted headers](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header). Requests made with `credentials: "include"` are not supported: the API authenticates with a bearer token and sends `Access-Control-Allow-Origin: *`, which browsers reject for credentialed requests.

## Patching notes

Send a JSON instruction: an operation (`replace`, `prepend`, `append`, or `delete`) applied to a scope (`content`, `marker`, `markerAndContent`, or `parent`) of a target: a heading (addressed as an array of heading texts from the top level down), a block reference, or a frontmatter key. The payload rides in `content` (a string), `value` (JSON, for frontmatter values), or `destination` (a heading move):

```sh
# Replace the value of a frontmatter field
curl -k -X PATCH \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  --data '{"targetType":"frontmatter","target":"status","operation":"replace","value":"done"}' \
  https://<host>:27124/vault/path/to/note.md
```

Heading levels inside a `content` string are relative to the target (a leading `#` becomes a direct child). Advisory warnings (e.g. a heading rebased past level 6) come back as percent-encoded JSON in the `Markdown-Patch-Warnings` response header: decode with `decodeURIComponent` before parsing. Pass `ifMatch` (the `version` from a document map) for optimistic concurrency.

Whitespace is library-owned: your content is reduced to trimmed, canonical form (leading and trailing blank lines are meaningless), and the API itself supplies the blank line wherever inserted content faces body text, so an `append` or `prepend` always lands as its own block and never merges into an existing paragraph. Heading lines, existing blank lines, and each document's spacing style are preserved as-is.

To *continue* an existing block instead of starting a new one (say, extending a list), add `within` to a heading instruction: an index selecting one of the section's top-level body blocks (0-based in document order, negative counting from the end, so `-1` is the last block). A `within` edit splices literally, so you own the joint:

```sh
# Add an item to the last list under "Log" (the leading \n continues the block)
curl -k -X PATCH \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  --data '{"targetType":"heading","target":["Log"],"within":-1,"operation":"append","content":"\n- new item"}' \
  https://<host>:27124/vault/path/to/note.md
```

With `markerAndContent` scope, `prepend`/`append` instead insert a *new* block beside the indexed one. Indices are positional, so read the document map first and pair the edit with `ifMatch`.

### Raw-content mode

If your client *templates* markdown into the request body (Shortcuts, Tasker, curl from a template), JSON-escaping that content into an instruction is fragile. Raw-content mode moves the instruction's fields out of the body: target in the URL (or in `Target-Type`/`Target` headers with an explicit `Markdown-Patch-Version: 2`), operation and options in headers, and the body is the raw payload, no JSON escaping required:

```sh
# Append a templated line under a heading, no JSON escaping anywhere
curl -k -X PATCH \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Operation: append" \
  -H "Content-Type: text/markdown" \
  --data "- $TEMPLATED_CONTENT" \
  https://<host>:27124/vault/notes/daily.md/heading/Log
```

A `text/*` body is the `content` carrier, an `application/json` body the `value` carrier, and no body at all carries nothing (a `delete`, or a move via a `Destination` header). `Target-Scope`, `Within` (the instruction's `within` index as a plain integer, e.g. `-1`), `Create-Target-If-Missing`, `Reject-If-Content-Preexists`, and `If-Match` headers round out the instruction. See the [interactive docs](https://coddingtonbear.github.io/obsidian-local-rest-api/) for the header encodings and the full details.

The older header-driven PATCH format spread the instruction across request headers instead of a JSON body, and is deprecated and will be removed in 6.0. It still works: send `Markdown-Patch-Version: 1` to opt back into it (the same header also selects the legacy `::`-joined document map on GET), and responses served by it carry a `Deprecation: true; sunset-version="6.0"` header. To upgrade, drop that header and move each header into the JSON body; the [interactive docs](https://coddingtonbear.github.io/obsidian-local-rest-api/) have the field-by-field mapping table. If your content contains headings, adjust their levels too: 1.x wrote them literally, and 2.x treats them as relative to the target (see the migration guide there).

## Targeting specific sections

You can read or write a specific part of a note (a heading, block reference, or frontmatter field) without fetching or replacing the whole file. This works on GET, PUT, POST, and PATCH requests (for PATCH this is [raw-content mode](#raw-content-mode): add an `Operation` header).

Append `/<target-type>/<target>` after the filename. Each nested heading level is its own path segment, so a heading whose text contains `::` needs no escaping:

```sh
# Read the content under a specific heading
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://<host>:27124/vault/path/to/note.md/heading/My%20Section

# Read a nested heading (one path segment per level)
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://<host>:27124/vault/path/to/note.md/heading/Work/Meetings

# Read a frontmatter field
curl -k -H "Authorization: Bearer <your-api-key>" \
  https://<host>:27124/vault/path/to/note.md/frontmatter/status

# Replace the content of a heading via PUT (heading levels are normalized for you)
curl -k -X PUT \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: text/markdown" \
  --data "Updated content" \
  https://<host>:27124/vault/path/to/note.md/heading/My%20Section

# Append to a heading via POST
curl -k -X POST \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: text/markdown" \
  --data "Appended content" \
  https://<host>:27124/vault/path/to/note.md/heading/My%20Section
```

Supported target types: `heading`, `block`, `frontmatter`.

A targeted URL is ambiguous on its face: `/vault/notes/log.md/heading/Today` could name the `Today` section of `notes/log.md` or a file literally called `notes/log.md/heading/Today`. The server walks backwards down the path until it finds a real file and reports which one it settled on in a `Content-Location` response header, with each path component percent-encoded on its own (non-ASCII characters, and reserved characters like `#`, `?` and `,`) so it can be pasted straight back into a request URL. A request whose URL names the file outright gets no such header.

On a GET, a `Target-Scope` header selects which part of the target comes back, mirroring the PATCH scopes: `content` (the default), `marker` (the label: a heading's raw text, a block's bare id, a frontmatter key), or `markerAndContent` (the whole node, in the shape a PATCH `replace` at that scope consumes: a heading subtree reads back with its own line as `# Title`, levels relative to its parent):

```sh
# Read a whole section, heading line included, ready to edit and write back
curl -k -H "Authorization: Bearer <your-api-key>" \
  -H "Target-Scope: markerAndContent" \
  https://<host>:27124/vault/path/to/note.md/heading/My%20Section
```

Header-based targeting is deprecated. Earlier releases targeted a section with `Target-Type`, `Target`, and `Target-Delimiter` headers (plus `Target-Scope`/`Trim-Target-Whitespace`). That form will be removed in 6.0; it is only processed when you also send `Markdown-Patch-Version: 1` (responses then carry a `Deprecation` header). Without it, supplying those targeting headers is rejected with `400`. Supplying both URL-path targeting and the header form on one request returns `422 Unprocessable Entity`.

## Searching

`POST /search/simple/?query=your+terms` returns the notes that contain every word of the query, case-insensitively, with scored context snippets.

`POST /search/` accepts a [JsonLogic](https://jsonlogic.com/) expression (content type `application/vnd.olrapi.jsonlogic+json`) and evaluates it against each note's metadata (frontmatter, tags, path, content).

## Event streams

You can follow what happens in the vault as a [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream. Register a subscription to one event, with an optional JsonLogic filter, then open the URL that comes back:

```sh
# 1. Subscribe to notes under journal/ being modified
curl -X POST -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/vnd.olrapi.jsonlogic+json" \
  -d '{"glob": ["journal/*", {"var": "path"}]}' \
  https://<host>:27124/events/vault/modify/
# => {"id": "…", "url": "https://<host>:27124/events/vault/modify/…/?sig=…&exp=…&n=…", …}

# 2. Follow the stream; with signed URLs on, the URL needs no API key
curl -N "<url>"
```

It takes two steps because a browser's `EventSource` can only make `GET` requests, which have no body to carry a filter.

Only these events can be streamed:

| Emitter | Events |
|---|---|
| `vault` | `create`, `modify`, `delete`, `rename` |
| `metadataCache` | `changed`, `deleted`, `resolve`, `resolved` |

Each event sends the path, the file's NoteJson (the same shape `/search/` evaluates), and a few event-specific fields such as `oldPath` on a rename. Note content is sent only when the filter reads `file.content`. There is no `workspace` emitter, because no Obsidian window is open to produce editor, layout, or file-open events. To react to frontmatter changes, use `metadataCache` `changed`: `vault` `modify` fires before Obsidian has re-read the file's metadata.

Each message's `id` is `<epoch>-<counter>`. A new epoch, or a gap in the counter, means events were missed. Nothing is replayed. A stream URL expires after the signed-URL lifetime (or `?ttl=<seconds>`), but a stream opened before then stays open. At most 16 streams can be open at once. Anyone holding a signed stream URL sees the paths and metadata of every event its filter matches, so treat it like the notes themselves. See the [API docs](https://coddingtonbear.github.io/obsidian-local-rest-api/) for the full message format.

## MCP (Model Context Protocol)

The transport is Streamable HTTP, with the API key as a bearer token.

### Protocol revisions

The endpoint serves the `2026-07-28` revision plus the sessionful revisions from `2024-10-07` through `2025-11-25`, choosing per request, so clients on either can share it.

The `2026-07-28` revision is stateless: there is no `initialize` handshake and no session, so the plugin neither issues nor reads the `Mcp-Session-Id` header. Each request carries its own protocol version and client identity in `params._meta`, repeats them in the `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers, and is answered on its own. Clients can call `server/discover` to learn the supported revisions and capabilities up front.

Clients that open with an `initialize` request are served the sessionful revision they negotiate: the handshake returns an `Mcp-Session-Id`, `GET /mcp/` opens that session's notification stream, and `DELETE /mcp/` ends it. Sessions exist only on this path, and they are what keeps the handshake's `listChanged` capabilities honest: when the tool list changes (signed-URL tools come and go with that setting), every live session is notified, while `2026-07-28` clients hear about it on a `subscriptions/listen` stream.

### Available tools

| Tool | Description |
|---|---|
| `vault_list` | List files and subdirectories inside a vault directory |
| `vault_read` | Read a text file's content, frontmatter, tags, and stat; refuses anything that is not valid UTF-8 |
| `vault_read_binary` | Read an attachment: images as an image block the model can see, anything else as a download link or embedded bytes |
| `vault_get_download_url` | Mint a signed, expiring link to a file that works without the API key (only when signed URLs are enabled) |
| `vault_get_upload_url` | Mint a signed, single-use link for uploading a file over `PUT` (only when signed URLs are enabled) |
| `events_get_listener_url` | Subscribe to an Obsidian event and mint a signed link to its Server-Sent Events stream (only when signed URLs are enabled) |
| `vault_write` | Create or overwrite a text file; refuses paths whose extension names a binary type |
| `vault_append` | Append content to the end of a vault file |
| `vault_patch` | Patch a specific heading, block reference, or frontmatter field |
| `vault_delete` | Delete a vault file (moves to trash by default) |
| `vault_move` | Move (rename) a vault file to a new path |
| `vault_copy` | Copy a vault file to a new path |
| `vault_get_document_map` | List the headings, block references, and frontmatter fields in a file |
| `search_query` | Search using a [JsonLogic](https://jsonlogic.com/) query against note metadata |
| `search_simple` | Full-text search for notes containing every word of the query |
| `tag_list` | List all tags across the vault with usage counts |

### Binary files and attachments

The REST API handles binary content: `GET /vault/<path>` returns raw bytes with a `Content-Type` derived from the file extension, and `PUT /vault/<path>` accepts a body of any content type and stores it byte-for-byte. Neither has a practical size limit.

MCP tool arguments and results pass through the model. `vault_read` and `vault_write` are text tools: they decode and encode UTF-8, which is lossy for anything that is not text, so `vault_read` refuses a file whose bytes are not valid UTF-8, and `vault_write` and `vault_append` refuse a path whose extension names an image (other than SVG, which is text), audio, video, font, PDF, or archive type. Reading an attachment as text and writing the result back is the mistake that destroys attachments, and both halves of it are refused.

`vault_read_binary` is the tool for attachments, and what it returns depends on the file:

- Raster images come back as an MCP `image` content block, downscaled to fit 1568px on the long side, plus a small text block with the file's path, MIME type, size, and dimensions. The model sees the picture and is billed for its pixels, so a multi-megabyte photo costs a couple of thousand tokens. An image still over 512 KiB after downscaling (one already inside 1568px, so nothing was resized) comes back as a download link instead, the same as any other oversized file, or is refused with a pointer at the REST endpoint when signed URLs are off and there is no link to give.
- SVGs come back unchanged, as their source text in a `resource` block. Nothing is rasterized or resized.
- Everything else comes back as a `resource_link` to a signed download URL when signed URLs are enabled (below), so the bytes never enter the conversation. When they are not enabled, a file under 512 KiB is embedded as a `resource` block with base64 bytes, and a larger one is refused with a pointer at the REST endpoint.

An `as` argument overrides the default: `as: "bytes"` embeds the raw bytes (under 512 KiB), `as: "link"` returns a signed link and never reads the file.

There is no upload tool that carries bytes through the model: emitting base64 as output tokens is impractical beyond a few kilobytes. The agent's host has the file on disk; it uploads it with a `PUT` to the REST API, either with the API key or with a signed upload URL.

### Signed URLs

Signed URLs let an agent hand a file to something that is not the MCP client (a browser tab, an `<img>` tag, a `curl` in a shell) without also handing over the API key. They are on by default; turn them off with `ENABLE_SIGNED_URLS=false`, and set their lifetime with `SIGNED_URL_TTL_SECONDS` (default 300 seconds).

While they are on, these MCP tools mint them:

- `vault_get_download_url` returns a `resource_link` to `GET /vault/<path>?sig=…&exp=…&n=…`, plus a markdown link for clients that only render text. The link is valid until it expires and can be used repeatedly. Add `&download=1` to have the browser save the file instead of showing it.
- `vault_get_upload_url` returns a `PUT /vault/<path>?sig=…&exp=…&n=…` URL and a ready-to-run `curl` command, with the filename quoted for a POSIX shell so a name containing `$`, backticks or spaces cannot be expanded when the command is pasted. The link is consumed by the first request that succeeds: claimed at authorization rather than at completion, so concurrent redemptions cannot all pass, and released again if the request does not end in a 2xx. The `Content-Type` is informational on a signed upload: the bytes are stored exactly as sent, whatever type is declared, because a signed URL authorizes a whole-file write of that content.
- `vault_read_binary` uses download links for non-image files, and for anything when called with `as: "link"`.
- `events_get_listener_url` registers an [event stream](#event-streams) subscription and returns its `GET /events/<emitter>/<event>/<id>/?sig=…&exp=…&n=…` URL, plus a `curl -N` command. `POST /events/<emitter>/<event>/` returns the same kind of URL.

A signed URL authorizes a whole-file write to the path it names, and only that: a request that also carries `Target-Type`/`Target` headers, or whose path continues into `/heading`, `/block` or `/frontmatter`, is refused. Use the API key for targeted writes.

The signature is an HMAC over the method, the normalized vault path, the expiry, and a random per-link nonce carried as `n`, under a secret generated fresh every time the server starts and kept only in memory. A link is therefore good for one file, one method, one window of time, and never survives a restart. The nonce makes two links minted in the same second differ. The host is not part of the signature, so the same link works whichever hostname on the certificate the client uses. Anyone holding a link can do what it names until it expires, so treat one as you would the file itself.

Whether a chat client renders a linked image inline is up to the client, and most do not today, but clicking through always works; and a link on the HTTPS port needs the server's certificate to be trusted by whatever opens it. The plain-HTTP port avoids that, inside a tunnel.

### Available resources

| URI | Description |
|---|---|
| `obsidian://local-rest-api/openapi.yaml` | Full OpenAPI specification for this REST API |

## Contributing

Changes to the API itself (routes, MCP tools, PATCH, search) belong upstream in [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api), and this fork takes them in from there. Issues and changes about the container, the stand-in for Obsidian in [`src/standalone`](src/standalone), or the network restrictions belong here.

## Credits

The API is [Adam Coddington](https://github.com/coddingtonbear)'s [Local REST API with MCP](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin, MIT licensed; this repository runs it without Obsidian. The plugin was inspired by [Vinzent03](https://github.com/Vinzent03)'s [advanced-uri plugin](https://github.com/Vinzent03/obsidian-advanced-uri).
