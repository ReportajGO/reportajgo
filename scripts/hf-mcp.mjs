/**
 * Direct Higgsfield MCP access using the OAuth token in .secrets/, i.e. the
 * account you logged in with in the browser — NOT whatever account a chat
 * client's connector happens to be bound to.
 *
 * Standalone on purpose: it does not import src/config/env.ts, so it runs
 * without a populated .env or a database.
 *
 *   node scripts/hf-mcp.mjs balance
 *   node scripts/hf-mcp.mjs call <toolName> '<jsonArgs>'
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TOKEN_FILE = resolve(process.cwd(), ".secrets/higgsfield-oauth.json");
const TOKEN_ENDPOINT = "https://mcp.higgsfield.ai/oauth2/token";
const MCP_URL = new URL("https://mcp.higgsfield.ai/mcp");

function readStore() {
  return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
}

export async function getAccessToken(forceRefresh = false) {
  const store = readStore();
  if (!forceRefresh && store.accessToken && store.expiresAt - 60_000 > Date.now()) {
    return store.accessToken;
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: store.refreshToken,
      client_id: store.clientId,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `token refresh failed: HTTP ${res.status} ${await res.text()}\n` +
        "Run `npm run higgsfield:login` to re-authorize.",
    );
  }
  const tok = await res.json();
  store.accessToken = tok.access_token;
  store.expiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000;
  if (tok.refresh_token) store.refreshToken = tok.refresh_token;
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
  return tok.access_token;
}

let client;
export async function mcp() {
  if (client) return client;
  const token = await getAccessToken();
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: "reportajgo-agent", version: "0.1.0" }, { capabilities: {} });
  await c.connect(transport);
  client = c;
  return c;
}

function parse(result) {
  if (result?.isError) {
    throw new Error(`MCP tool error: ${(result.content ?? []).map((b) => b.text ?? "").join(" ")}`);
  }
  if (result?.structuredContent) return result.structuredContent;
  for (const block of result?.content ?? []) {
    const text = block.text?.trim();
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const start = text.search(/[[{]/);
      const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          /* keep looking */
        }
      }
    }
  }
  return result;
}

export async function call(name, args = {}) {
  const c = await mcp();
  return parse(await c.callTool({ name, arguments: args }));
}

/** Drop the cached connection so the next call() dials again. */
export function reset() {
  client = undefined;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("hf-mcp.mjs")) {
  const [, , cmd, toolName, jsonArgs] = process.argv;
  const run = async () => {
    if (cmd === "balance") {
      console.log("balance        :", JSON.stringify(await call("balance", {})));
      console.log("workspaces     :", JSON.stringify(await call("list_workspaces", {})));
      return;
    }
    if (cmd === "call") {
      // `@path` reads the JSON from a file — PowerShell mangles inline JSON
      // when handing it to a native command.
      const raw = jsonArgs?.startsWith("@") ? readFileSync(jsonArgs.slice(1), "utf8") : jsonArgs;
      console.log(JSON.stringify(await call(toolName, raw ? JSON.parse(raw) : {}), null, 2));
      return;
    }
    throw new Error("usage: node scripts/hf-mcp.mjs balance | call <tool> '<json>'");
  };
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("FAILED:", err?.message ?? err);
      process.exit(1);
    });
}
