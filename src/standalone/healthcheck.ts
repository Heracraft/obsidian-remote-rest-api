/** The container's health check: asks the running server for `GET /`, which
 *  answers without an API key, on whichever listener is on. Exits 0 when the
 *  server answers 200, 1 otherwise. Reads the same environment as the server,
 *  so it follows PORT, BINDING_HOST and the rest without its own settings. */

import http from "http";
import https from "https";
import { loadConfig } from "./config";

function probe(): Promise<boolean> {
  const config = loadConfig();
  const { settings } = config;
  const bound = settings.bindingHost ?? "0.0.0.0";
  const host = bound === "0.0.0.0" ? "127.0.0.1" : bound === "::" ? "::1" : bound;
  const secure = settings.enableSecureServer !== false;
  const request = secure ? https.request : http.request;
  return new Promise((resolve) => {
    const req = request(
      {
        host,
        port: secure ? settings.port : settings.insecurePort,
        path: "/",
        method: "GET",
        timeout: 4000,
        // The server's own certificate; only liveness is being checked.
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

probe().then(
  (healthy) => process.exit(healthy ? 0 : 1),
  () => process.exit(1),
);
