import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../../config/logger.js";
import { getAccessToken } from "./oauth.js";

const log = logger.child({ module: "higgsfield-mcp" });

const MCP_URL = new URL("https://mcp.higgsfield.ai/mcp");

let client: Client | undefined;

async function connect(forceRefresh = false): Promise<Client> {
  const token = await getAccessToken(forceRefresh);
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: "reportajgo-agent", version: "0.1.0" }, { capabilities: {} });
  await c.connect(transport);
  client = c;
  log.info("connected to Higgsfield MCP");
  return c;
}

function isAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("401") || m.includes("unauthor") || m.includes("invalid_token") || m.includes("403");
}

/**
 * Call a Higgsfield MCP tool, returning its parsed JSON payload. Reconnects with
 * a freshly-refreshed token once on an auth error.
 */
export async function mcpCallTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const c = client ?? (await connect());
  try {
    return parseToolResult(await c.callTool({ name, arguments: args }));
  } catch (err) {
    if (isAuthError(err)) {
      log.warn("MCP auth error; reconnecting with a fresh token");
      const fresh = await connect(true);
      return parseToolResult(await fresh.callTool({ name, arguments: args }));
    }
    throw err;
  }
}

/** Extract the JSON payload from an MCP tool result (structured or text). */
function parseToolResult(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
  if (r.isError) {
    const text = (r.content ?? []).map((b) => b.text ?? "").join(" ");
    throw new Error(`MCP tool error: ${text || "unknown"}`);
  }
  if (r.structuredContent) return r.structuredContent;

  // Find the first text block that parses as JSON.
  for (const block of r.content ?? []) {
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
