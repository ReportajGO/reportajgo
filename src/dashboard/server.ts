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
  // Strict login gate for every surface (UI, API, media). No-op if unconfigured.
  app.use(dashboardAuth());
  app.use("/api", api);
  // Generated media (Gemini images) served from the media directory.
  app.use("/media", express.static(MEDIA_ROOT));
  // Static UI lives alongside this module (copied to dist on build).
  app.use(express.static(join(__dirname, "public")));

  const server = app.listen(env.DASHBOARD_PORT, () => {
    log.info({ port: env.DASHBOARD_PORT }, `approval dashboard on http://localhost:${env.DASHBOARD_PORT}`);
  });
  return server;
}
