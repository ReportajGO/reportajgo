// Original location: src/app/api/telegram/route.ts
import { webhookCallback } from "grammy";
import { bot, WEBHOOK_SECRET } from "@/lib/telegram";
import { registerModerationHandlers } from "@/lib/telegram-moderation";

/**
 * Telegram webhook endpoint.
 *
 * Security model (two layers):
 *  1. Telegram is told to send the secret in the
 *     `X-Telegram-Bot-Api-Secret-Token` header (configured by the set-webhook
 *     script). We reject any request whose header doesn't match.
 *  2. Inside the bot, every button press is additionally checked against the
 *     allow-list of Telegram user ids (see telegram-moderation.ts).
 *
 * Must run on the Node.js runtime — grammY + Prisma are not Edge-compatible.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Register the ✅/❌/schedule handlers once per server instance.
registerModerationHandlers();

// grammY adapter that speaks the Web Fetch `Request`/`Response` API used by the
// Next.js App Router. It also verifies the secret-token header for us.
const handle = webhookCallback(bot, "std/http", {
  secretToken: WEBHOOK_SECRET || undefined,
});

export async function POST(req: Request): Promise<Response> {
  // Defense in depth: refuse outright if the secret isn't configured, so a
  // misconfigured deploy can't accept anonymous updates.
  if (!WEBHOOK_SECRET) {
    return new Response("Webhook secret not configured", { status: 503 });
  }

  try {
    return await handle(req);
  } catch (err) {
    // grammY throws on a bad/missing secret token → treat as forbidden.
    console.error("[telegram] webhook error:", err);
    return new Response("Forbidden", { status: 401 });
  }
}

// A simple GET so you can eyeball that the route is mounted (no secrets leaked).
export function GET(): Response {
  return new Response("Telegram webhook is up. Use POST.", { status: 200 });
}
