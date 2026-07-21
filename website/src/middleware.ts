import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// First-party visitor id used for audience analytics (unique visitors). Set
// once and reused for a year; httpOnly so only the server (/api/track) reads it.
const VISITOR_COOKIE = "rgo_vid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export default function middleware(req: NextRequest) {
  const res = intlMiddleware(req);
  if (!req.cookies.get(VISITOR_COOKIE)) {
    res.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      maxAge: ONE_YEAR_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }
  return res;
}

export const config = {
  // Run on all paths except API, Next internals, and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
