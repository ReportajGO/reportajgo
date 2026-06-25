import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: "higgsfield-oauth" });

// Auth server (from mcp.higgsfield.ai OAuth discovery). Supports
// authorization_code + PKCE + refresh_token + dynamic client registration.
const AUTH_BASE = "https://mcp.higgsfield.ai";
const AUTH_ENDPOINT = `${AUTH_BASE}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${AUTH_BASE}/oauth2/token`;
const REGISTER_ENDPOINT = `${AUTH_BASE}/oauth2/register`;
const SCOPES = "openid email offline_access";

// Loopback redirect for the one-time interactive login.
const CALLBACK_PORT = 8765;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

// Where the refresh token + client registration are persisted. A deployed
// server can instead set HIGGSFIELD_REFRESH_TOKEN (and HIGGSFIELD_CLIENT_ID).
const TOKEN_FILE = (() => {
  const p = process.env.HIGGSFIELD_TOKEN_FILE || ".secrets/higgsfield-oauth.json";
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
})();

interface TokenStore {
  clientId?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number; // epoch ms
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readStore(): TokenStore {
  try {
    if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as TokenStore;
  } catch (err) {
    log.warn({ err }, "could not read token store");
  }
  return {};
}

function writeStore(store: TokenStore): void {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

/** Register a public OAuth client (cached in the token store). */
async function ensureClientId(store: TokenStore): Promise<string> {
  if (process.env.HIGGSFIELD_CLIENT_ID) return process.env.HIGGSFIELD_CLIENT_ID;
  if (store.clientId) return store.clientId;

  const res = await fetch(REGISTER_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ReportajGO Agent",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`client registration failed: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { client_id: string };
  store.clientId = json.client_id;
  writeStore(store);
  log.info("registered OAuth client");
  return json.client_id;
}

/** Wait for the OAuth redirect on the loopback server and return the code. */
function waitForCode(expectedState: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">` +
          (error || !code
            ? `<h2>Authorization failed</h2><p>${error ?? "no code returned"}</p>`
            : `<h2>✓ ReportajGO connected to Higgsfield</h2><p>You can close this tab.</p>`) +
          `</body></html>`,
      );
      server.close();
      if (error || !code) return reject(new Error(`authorization failed: ${error ?? "no code"}`));
      if (state !== expectedState) return reject(new Error("state mismatch (possible CSRF)"));
      resolvePromise(code);
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT);
  });
}

/**
 * One-time interactive login (authorization_code + PKCE). Prints a URL for the
 * user to open, captures the redirect, exchanges the code, and persists the
 * refresh token. Run via `npm run higgsfield:login`.
 */
export async function interactiveLogin(): Promise<void> {
  const store = readStore();
  const clientId = await ensureClientId(store);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  // eslint-disable-next-line no-console
  console.log(
    `\n1) Open this URL in your browser and authorize Higgsfield:\n\n${authUrl.toString()}\n\n` +
      `2) Waiting for you to approve…\n`,
  );

  const code = await waitForCode(state);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  if (!tok.refresh_token) {
    throw new Error("no refresh_token returned — offline_access scope may be missing");
  }

  store.refreshToken = tok.refresh_token;
  store.accessToken = tok.access_token;
  store.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  writeStore(store);
  // eslint-disable-next-line no-console
  console.log(`✓ Logged in. Refresh token saved to ${TOKEN_FILE}\n`);
}

/** Whether we have credentials to obtain an access token without interaction. */
export function hasRefreshToken(): boolean {
  return Boolean(process.env.HIGGSFIELD_REFRESH_TOKEN || readStore().refreshToken);
}

/**
 * Get a valid access token, refreshing with the stored refresh token if needed.
 * Pass forceRefresh=true to bypass the cache (e.g. after a 401 from the server).
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const store = readStore();
  const refreshToken = process.env.HIGGSFIELD_REFRESH_TOKEN || store.refreshToken;
  if (!refreshToken) {
    throw new Error("Higgsfield not logged in — run `npm run higgsfield:login` first.");
  }

  // Reuse a still-valid cached access token (60s safety margin).
  if (!forceRefresh && store.accessToken && store.expiresAt && store.expiresAt - 60_000 > Date.now()) {
    return store.accessToken;
  }

  const clientId = process.env.HIGGSFIELD_CLIENT_ID || store.clientId;
  if (!clientId) throw new Error("missing client id — run `npm run higgsfield:login` first.");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };

  store.accessToken = tok.access_token;
  store.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  // Refresh-token rotation: persist the new one if the server returned it.
  if (tok.refresh_token) store.refreshToken = tok.refresh_token;
  if (!process.env.HIGGSFIELD_REFRESH_TOKEN) writeStore(store);
  return tok.access_token;
}
