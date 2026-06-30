import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkApiKey } from "@/lib/agentAuth";
import { locales } from "@/i18n/routing";
import { themeLabels } from "@/lib/translate";

// Prisma + remote translation need the Node.js runtime, not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(c: { status: number; error: string }) {
  return NextResponse.json({ error: c.error }, { status: c.status });
}

type ThemeInput = { slug: string; name: string; lang?: string };

/** Build the localized labels JSON for a theme name. */
async function buildLabels(name: string, lang: string): Promise<string> {
  const src = (locales as readonly string[]).includes(lang) ? lang : "en";
  try {
    const tr = await themeLabels(name, src);
    const labels: Record<string, string> = {};
    for (const loc of locales) labels[loc] = tr[loc]?.trim() || name;
    return JSON.stringify(labels);
  } catch (err) {
    console.error("[agent] theme label translation failed:", err);
    // Identity fallback: show the same name on every locale.
    const labels: Record<string, string> = {};
    for (const loc of locales) labels[loc] = name;
    return JSON.stringify(labels);
  }
}

/**
 * POST /api/agent/themes — sync the site's themes to the agent's topic filters.
 *
 * The agent sends its FULL desired theme list every time the operator edits the
 * topic chips. We upsert each one (creating its localized labels) and deactivate
 * any theme no longer in the list, so adding/removing a filter makes the matching
 * theme page + nav item appear/disappear immediately.
 *
 * Body: { themes: [{ slug, name, lang? }] }
 *  - 200 { ok:true, active, deactivated }
 *  - 400 invalid body · 401|403|503 auth.
 */
export async function POST(req: Request) {
  const auth = checkApiKey(req);
  if (!auth.ok) return unauthorized(auth);

  const body = (await req.json().catch(() => null)) as { themes?: unknown } | null;
  if (!body || !Array.isArray(body.themes))
    return NextResponse.json({ error: "Body must be { themes: [...] }" }, { status: 400 });

  // Validate + normalize the incoming themes.
  const seen = new Set<string>();
  const themes: ThemeInput[] = [];
  for (const raw of body.themes as ThemeInput[]) {
    const slug = String(raw?.slug ?? "").trim().toLowerCase();
    const name = String(raw?.name ?? "").trim();
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    themes.push({ slug, name, lang: raw?.lang });
  }
  if (themes.length === 0)
    return NextResponse.json({ error: "No valid themes provided" }, { status: 400 });

  // Upsert each theme; order mirrors the agent's topic order.
  for (let i = 0; i < themes.length; i++) {
    const t = themes[i];
    const labels = await buildLabels(t.name, t.lang ?? "en");
    await prisma.category.upsert({
      where: { slug: t.slug },
      create: { slug: t.slug, labels, order: i, active: true },
      update: { labels, order: i, active: true },
    });
  }

  // Any theme not in the incoming list is hidden from the nav (posts kept).
  const slugs = themes.map((t) => t.slug);
  const deactivated = await prisma.category.updateMany({
    where: { slug: { notIn: slugs }, active: true },
    data: { active: false },
  });

  return NextResponse.json({
    ok: true,
    active: slugs.length,
    deactivated: deactivated.count,
  });
}
