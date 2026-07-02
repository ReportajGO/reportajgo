import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Server } from "node:http";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { MEDIA_ROOT } from "../generate/media/mediaStore.js";
import { dashboardAuth } from "./auth.js";
import { api } from "./routes.js";

const log = logger.child({ module: "dashboard" });
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Start the approval dashboard (static UI + JSON API). */
/**
 * CSRF guard for the JSON API: browsers won't send a custom header cross-origin
 * without a passing CORS preflight, so requiring X-Requested-With blocks
 * cross-site form/fetch attacks that ride cached Basic-auth credentials.
 * Safe (GET/HEAD) requests are exempt.
 */
function requireXhrHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.get("x-requested-with") !== "XMLHttpRequest") {
    res.status(403).json({ ok: false, error: "Missing X-Requested-With header" });
    return;
  }
  next();
}

export function startDashboard(): Server {
  const app = express();
  // The dashboard sits behind loopback (or a trusted proxy); trust the proxy so
  // rate-limit keying uses the real client IP when one is configured.
  app.set("trust proxy", 1);
  // Security headers (CSP tuned for the self-hosted static UI + same-origin API).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "https:"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  // Generated media is public (it's published on the website and to social
  // platforms anyway) so the site can load image URLs without credentials.
  app.use("/media", express.static(MEDIA_ROOT));
  // Brand favicon is public (not sensitive) so the tab icon shows on the login
  // page too — served before the auth gate.
  const publicDir = join(__dirname, "public");
  app.get("/favicon.ico", (_req, res) => res.sendFile(join(publicDir, "favicon.ico")));
  app.get("/icon.png", (_req, res) => res.sendFile(join(publicDir, "icon.png")));
  // Brute-force protection: cap requests per IP before the credential check so a
  // weak password can't be guessed at speed. Generous enough for normal UI use.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { ok: false, error: "Too many requests — slow down." },
  });
  app.use(limiter);
  // Strict login gate for the UI + API. Fails closed in production.
  app.use(dashboardAuth());
  // CSRF guard + JSON API (auth first, so unauthenticated callers never reach it).
  app.use("/api", requireXhrHeader, api);
  // Static UI lives alongside this module (copied to dist on build).
  app.use(express.static(join(__dirname, "public")));

  // Bind to loopback by default so the control API isn't exposed on the network.
  const server = app.listen(env.DASHBOARD_PORT, env.DASHBOARD_BIND, () => {
    log.info(
      { port: env.DASHBOARD_PORT, bind: env.DASHBOARD_BIND },
      `approval dashboard on http://${env.DASHBOARD_BIND}:${env.DASHBOARD_PORT}`,
    );
  });
  return server;
}
