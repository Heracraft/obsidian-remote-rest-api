Remote REST API serves a folder of markdown notes (an Obsidian vault or any other) over two interfaces, with no Obsidian app running. It is the Local REST API with MCP plugin for Obsidian, run as a standalone server:

- **REST API** — standard HTTP endpoints for reading and writing notes, searching vault contents, and more. Useful from scripts, applications, or any HTTP client.
- **MCP server** — exposes the same capabilities as structured tools for AI assistants (Claude, Cursor, and other MCP-compatible clients). See the `POST /mcp/` endpoint for connection details.

## Testing with this interface

Select any operation in the sidebar, then open the **Try It** tab to send a live request to your running server.

**Authentication** — all requests require a Bearer token. In the **Try It** panel, expand the **Security** section and paste the server's API key: the `API_KEY` it was started with, or the one it logged when it generated it (kept in `data.json` in its data directory).

**Certificate warning** — the server generates its own certificate authority on first run and serves a TLS certificate signed by it. Most browsers will block requests to an untrusted certificate, so you may need to download the certificate authority from `/obsidian-local-rest-api.crt` and add it as a trusted authority in your OS or browser settings before requests will go through. The steps vary by environment — search for "trust self-signed certificate" plus your OS or browser name if you're unsure. If that proves too cumbersome, you can start the server with `ENABLE_INSECURE_SERVER=true` instead, inside a Tailscale or WireGuard tunnel only, and select "HTTP (insecure mode)" from the **Try It** section.
