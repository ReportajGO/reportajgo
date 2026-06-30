import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import type { Server } from "node:http";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { MEDIA_ROOT } from "../generate/media/mediaStore.js";
import { dashboardAuth } from "./auth.js";
import { api } from "./routes.js";

const log = logger.child({ module: "dashboard" });
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Start the approval dashboard (static UI + JSON API). */
export function startDashboard(): Server {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Generated media is public (it's published on the website and to social
  // platforms anyway) so the site can load image URLs without credentials.
  app.use("/media", express.static(MEDIA_ROOT));
  // Brand favicon is public (not sensitive) so the tab icon shows on the login
  // page too — served before the auth gate.
  const publicDir = join(__dirname, "public");
  app.get("/favicon.ico", (_req, res) => res.sendFile(join(publicDir, "favicon.ico")));
  app.get("/icon.png", (_req, res) => res.sendFile(join(publicDir, "icon.png")));
  // Strict login gate for the UI + API. No-op if DASHBOARD_PASSWORD is unset.
  app.use(dashboardAuth());
  app.use("/api", api);
  // Static UI lives alongside this module (copied to dist on build).
  app.use(express.static(join(__dirname, "public")));

  const server = app.listen(env.DASHBOARD_PORT, () => {
    log.info({ port: env.DASHBOARD_PORT }, `approval dashboard on http://localhost:${env.DASHBOARD_PORT}`);
  });
  return server;
}
