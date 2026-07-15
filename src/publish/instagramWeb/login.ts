// One-time interactive Instagram login.
//
//   npm run instagram:login
//
// Opens a real (headed) Chromium window using a PERSISTENT profile. You log in
// to Instagram by hand — including 2FA / "save login info" — then CLOSE the
// window. The session is saved in the profile dir so every later post reuses it
// and never has to log in again (which is what keeps the automation from
// tripping Instagram's bot/login checks).
import { chromium } from "playwright";
import { env } from "../../config/env.js";
import { INSTAGRAM_PROFILE_DIR, INSTAGRAM_STATE_FILE, VIEWPORT } from "./config.js";

async function main(): Promise<void> {
  const channel = env.INSTAGRAM_BROWSER_CHANNEL.trim();
  const base = {
    headless: false,
    viewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  const ctx = await chromium
    .launchPersistentContext(INSTAGRAM_PROFILE_DIR, channel ? { ...base, channel } : base)
    .catch(() => chromium.launchPersistentContext(INSTAGRAM_PROFILE_DIR, base));

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });

  console.log("\n────────────────────────────────────────────────────────");
  console.log(" A Chromium window opened.");
  console.log(" 1) Log in to your Instagram account (do any 2FA).");
  console.log("    If asked 'Save your login info?', choose Save.");
  console.log(" 2) When you reach your Instagram feed, CLOSE the window.");
  console.log(`    Your session will be saved to: ${INSTAGRAM_PROFILE_DIR}`);
  console.log("────────────────────────────────────────────────────────\n");

  // As soon as the login lands, export a portable storageState JSON. The profile
  // dir's own cookies are OS-encrypted and don't move between machines; this JSON
  // (plaintext cookies) is what seeds the headless server — see post.ts.
  void (async () => {
    for (let i = 0; i < 900; i++) {
      await page.waitForTimeout(1000).catch(() => {});
      const cookies = await ctx.cookies("https://www.instagram.com").catch(() => []);
      if (cookies.some((c) => c.name === "sessionid" && c.value)) {
        await ctx.storageState({ path: INSTAGRAM_STATE_FILE }).catch(() => {});
        console.log(`✓ login detected — portable session written to ${INSTAGRAM_STATE_FILE}`);
        return;
      }
    }
  })();

  await new Promise<void>((resolve) => ctx.on("close", () => resolve()));
  console.log("✓ Instagram session saved. Set INSTAGRAM_PUBLISHER=web to use it.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Instagram login failed:", err);
  process.exit(1);
});
