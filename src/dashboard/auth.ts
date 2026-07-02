import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: "dashboard:auth" });

const REALM = "ReportajGO Control Panel";

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseBasic(header: string | undefined): { user: string; pass: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/**
 * HTTP Basic auth for the whole dashboard (UI + API + media). Enforced only
 * when DASHBOARD_PASSWORD is set; otherwise the dashboard stays open and we warn
 * loudly at startup so it's never silently exposed by accident.
 */
export function dashboardAuth(): RequestHandler {
  const password = env.DASHBOARD_PASSWORD;
  if (!password) {
    // Fail closed in production: never run an unauthenticated control API on a
    // real deploy. In dev we allow it (bound to loopback) but warn loudly.
    if (env.isProd) {
      throw new Error(
        "DASHBOARD_PASSWORD is required in production — refusing to start an open dashboard.",
      );
    }
    log.warn("DASHBOARD_PASSWORD not set — the dashboard is OPEN (dev only, loopback bind)");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const username = env.DASHBOARD_USERNAME;
  return (req: Request, res: Response, next: NextFunction) => {
    const creds = parseBasic(req.headers.authorization);
    if (creds && safeEqual(creds.user, username) && safeEqual(creds.pass, password)) {
      return next();
    }
    res.setHeader("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
    res.status(401).json({ ok: false, error: "Authentication required" });
  };
}
