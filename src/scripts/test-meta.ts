// Smoke test: verifies the Meta access token, the Instagram Business account,
// and lists the Pages the token can manage (so we know which META_FB_PAGE_ID to
// set). Read-only — does NOT publish anything.
// Usage: npx tsx src/scripts/test-meta.ts
import { env } from "../config/env.js";
import { listManagedPages } from "../publish/meta.js";

const GRAPH = `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

async function graphGet(path: string, fields?: string): Promise<any> {
  const qs = new URLSearchParams({ access_token: env.META_ACCESS_TOKEN ?? "" });
  if (fields) qs.set("fields", fields);
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = (await res.json()) as { error?: { message?: string } } & Record<string, any>;
  if (!res.ok || json.error) throw new Error(json.error?.message ?? res.statusText);
  return json;
}

async function main() {
  if (!env.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN is not set in .env");
  console.log(`Graph: ${env.META_GRAPH_VERSION}`);
  console.log(`Token prefix: ${env.META_ACCESS_TOKEN.slice(0, 8)}…`);

  // 1) Who is this token?
  const me = await graphGet("me", "id,name");
  console.log(`\nToken belongs to: ${me.name ?? "?"} (id ${me.id})`);

  // 2) The Instagram Business account we configured.
  if (env.META_IG_BUSINESS_ID) {
    try {
      const ig = await graphGet(
        env.META_IG_BUSINESS_ID,
        "id,username,name,followers_count,media_count",
      );
      console.log(
        `\n✅ Instagram OK: @${ig.username ?? "?"} (${ig.name ?? ""}) — ` +
          `${ig.followers_count ?? "?"} followers, ${ig.media_count ?? "?"} posts`,
      );
    } catch (e: unknown) {
      console.log(
        `\n❌ META_IG_BUSINESS_ID=${env.META_IG_BUSINESS_ID} did not resolve as an ` +
          `Instagram account: ${e instanceof Error ? e.message : e}`,
      );
      console.log("   (It may actually be a Facebook Page id — see the page list below.)");
    }
  } else {
    console.log("\n⚠️  META_IG_BUSINESS_ID is not set.");
  }

  // 3) Managed Pages → which FB Page id to set, and the linked IG account.
  try {
    const pages = await listManagedPages();
    if (pages.length === 0) {
      console.log("\n⚠️  Token cannot list any Pages (need pages_show_list / pages_manage_posts).");
    } else {
      console.log("\nManaged Pages (set META_FB_PAGE_ID to one of these):");
      for (const p of pages) {
        const ig = p.instagramBusinessId ? ` → IG ${p.instagramBusinessId}` : " (no IG linked)";
        console.log(`  • ${p.name}  —  page id ${p.id}${ig}`);
      }
    }
  } catch (e: unknown) {
    console.log(`\n⚠️  Could not list Pages: ${e instanceof Error ? e.message : e}`);
  }

  console.log("\nDone (read-only — nothing was published).");
}

main().catch((err) => {
  console.error("\nMETA TEST FAILED:");
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
