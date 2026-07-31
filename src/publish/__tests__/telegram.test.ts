import { describe, expect, test, vi } from "vitest";
import type { PublishInput } from "../publisher.js";

// telegram.ts pulls in env (brand URLs), the logger, telegraf and the media
// store at import time. Caption building needs none of that machinery.
vi.mock("../../config/env.js", () => ({
  env: {
    BRAND_TELEGRAM_URL: "https://t.me/reportagego",
    BRAND_INSTAGRAM_URL: "https://instagram.com/reportagego",
    BRAND_YOUTUBE_URL: "https://youtube.com/@reportagego",
  },
}));
vi.mock("../../config/logger.js", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));
vi.mock("../../generate/media/mediaStore.js", () => ({ MEDIA_ROOT: "/tmp/media" }));
vi.mock("telegraf", () => ({ Telegraf: class {} }));

const { buildTelegramCaption } = await import("../telegram.js");

const LONG_URL =
  "https://reportajgo.uz/uz/article/ozbekiston-va-turkiya-oliy-talim-aloqalarini-50-dan-ortiq-shartnoma-bilan";

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    platform: "TELEGRAM",
    body: "body text",
    hashtags: [],
    media: [],
    article: { title: "O‘zbekiston va Turkiya oliy ta'lim aloqalarini mustahkamladi" },
    articleUrl: LONG_URL,
    ...overrides,
  } as PublishInput;
}

describe("buildTelegramCaption", () => {
  test("shows a short domain instead of the long article URL", () => {
    const caption = buildTelegramCaption(input());

    expect(caption).toContain(">reportajgo.uz</a>");
    // The slug must not appear as visible text — that's what made posts long.
    expect(caption).not.toMatch(/Batafsil 👇👇👇\nhttps/);
  });

  test("keeps the full URL in the href so the link still works", () => {
    expect(buildTelegramCaption(input())).toContain(`href="${LONG_URL}"`);
  });

  test("strips a www. prefix from the visible label", () => {
    const caption = buildTelegramCaption(input({ articleUrl: "https://www.reportajgo.uz/uz/a/b" }));
    expect(caption).toContain(">reportajgo.uz</a>");
  });

  test("hides query strings (e.g. UTM tags) from the visible text", () => {
    const caption = buildTelegramCaption(
      input({ articleUrl: `${LONG_URL}?utm_source=telegram&utm_medium=social` }),
    );
    expect(caption).toContain(">reportajgo.uz</a>");
    expect(caption).not.toContain("utm_source=telegram<");
    // & must be entity-escaped inside the href or Telegram rejects the HTML.
    expect(caption).toContain("utm_source=telegram&amp;utm_medium=social");
  });

  test("falls back to the raw string when the URL can't be parsed", () => {
    const caption = buildTelegramCaption(input({ articleUrl: "not-a-url" }));
    expect(caption).toContain(">not-a-url</a>");
  });

  test("omits the details block entirely when there's no article URL", () => {
    const caption = buildTelegramCaption(input({ articleUrl: undefined }));
    expect(caption).not.toContain("Batafsil");
  });

  test("still carries the headline and the subscribe row", () => {
    const caption = buildTelegramCaption(input());
    expect(caption).toContain("<b>O‘zbekiston va Turkiya oliy ta&#039;lim".slice(0, 20));
    expect(caption).toContain("Batafsil 👇👇👇");
    expect(caption).toContain(">Telegram</a>");
    expect(caption).toContain(">Instagram</a>");
    expect(caption).toContain(">YouTube</a>");
  });

  test("the shortened caption is far under Telegram's 1024 caption cap", () => {
    const visible = buildTelegramCaption(input()).replace(/<[^>]+>/g, "");
    expect(visible.length).toBeLessThan(300);
  });
});
