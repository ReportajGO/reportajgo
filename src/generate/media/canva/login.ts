// One-time interactive Canva login.
//
//   npm run canva:login
//
// Opens a real (headed) Chromium window using a PERSISTENT profile. You log in
// to Canva by hand — including any CAPTCHA / 2FA — and then CLOSE the window.
// The session cookies are saved in the profile dir, so every later headless
// render reuses them and never has to log in again (which is what keeps the
// automation from tripping Canva's bot detection).
import { chromium } from "playwright";
import { CANVA_PROFILE_DIR, VIEWPORT } from "./config.js";

async function main(): Promise<void> {
  const ctx = await chromium.launchPersistentContext(CANVA_PROFILE_DIR, {
    headless: false,
    viewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.canva.com/login", { waitUntil: "domcontentloaded" });

  console.log("\n────────────────────────────────────────────────────────");
  console.log(" A Chromium window opened.");
  console.log(" 1) Log in to your Canva account (do any 2FA / CAPTCHA).");
  console.log(" 2) When you reach your Canva home, CLOSE the window.");
  console.log(`    Your session will be saved to: ${CANVA_PROFILE_DIR}`);
  console.log("────────────────────────────────────────────────────────\n");

  await new Promise<void>((resolve) => ctx.on("close", () => resolve()));
  console.log("✓ Canva session saved. You can now use CARD_RENDERER=canva.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Canva login failed:", err);
  process.exit(1);
});
